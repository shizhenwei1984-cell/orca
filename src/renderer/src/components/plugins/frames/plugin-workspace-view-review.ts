import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import type { AppState } from '@/store/types'
import { getWorktreeGitIdentityDisplay } from '../../../../../shared/worktree/row-display/git-identity-display'
import {
  getRepoExecutionHostId,
  getRepoSshConnectionId,
  type ExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import {
  getWorktreeCardReviewCacheKeys,
  resolveWorktreeCardReview
} from '../../sidebar/workspace-card/review/worktree-card-review-resolution'
import type { WorkspaceViewScope } from './plugin-workspace-view-scope'

function reviewLink(value: string | undefined): string | null {
  if (!value || value.length > 2048) {
    return null
  }
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? `${url.origin}${url.pathname}`
      : null
  } catch {
    return null
  }
}

type CheckoutGit = NonNullable<WorkspaceViewScope['git']>
type Upstream = { ahead: number; behind: number }

function workspaceViewReview(
  state: AppState,
  { repo, worktree }: CheckoutGit,
  pending: boolean,
  upstream: Upstream | null
) {
  const identity = getWorktreeGitIdentityDisplay(worktree)
  const keys = getWorktreeCardReviewCacheKeys(worktree, repo, state.settings)
  const entry = state.hostedReviewCache[keys.hostedReviewCacheKey]
  const { prDisplay } = resolveWorktreeCardReview(worktree, entry, state.prCache[keys.prCacheKey])
  const loaded = prDisplay && prDisplay.provider !== 'unsupported' && prDisplay.state
  return {
    checkout: identity?.kind ?? 'unavailable',
    branch: identity?.kind === 'branch' ? identity.branchName.slice(0, 200) : null,
    primary: worktree.isMainWorktree,
    upstream,
    review: {
      state: loaded || (pending ? 'loading' : 'unavailable'),
      refreshing: pending,
      number: loaded ? prDisplay.number : null,
      url: loaded ? reviewLink(prDisplay.url) : null,
      provider: loaded ? prDisplay.provider : null
    }
  }
}

async function refreshWorkspaceViewReview(
  state: AppState,
  { repo, worktree }: CheckoutGit,
  explicit: boolean
): Promise<void> {
  const { branch, hostedReviewCacheKey } = getWorktreeCardReviewCacheKeys(
    worktree,
    repo,
    state.settings
  )
  if (!hostedReviewCacheKey) {
    return
  }
  await state.fetchHostedReviewForBranch(repo.path, branch, {
    repoId: repo.id,
    repoOwnerExecutionHostId: getRepoExecutionHostId(repo),
    ...(branch && branch !== 'HEAD'
      ? { currentHeadOid: worktree.head }
      : { exactReviewKey: hostedReviewCacheKey }),
    linkedGitHubPR: worktree.linkedPR,
    linkedGitLabMR: worktree.linkedGitLabMR,
    linkedBitbucketPR: worktree.linkedBitbucketPR,
    linkedAzureDevOpsPR: worktree.linkedAzureDevOpsPR,
    linkedGiteaPR: worktree.linkedGiteaPR,
    ...(explicit ? { force: true, userRefresh: true, wakeWslDistro: true } : {})
  })
}

async function refreshUpstream(
  state: AppState,
  { repo, worktree }: CheckoutGit,
  hostId: ExecutionHostId,
  explicit: boolean
): Promise<Upstream | null> {
  const runtimeTarget = ipcOrRuntimeTargetForHostId(hostId)
  if (!runtimeTarget) {
    return null
  }
  const status = await state.fetchUpstreamStatus(
    worktree.id,
    worktree.path,
    getRepoSshConnectionId(repo) ?? undefined,
    worktree.pushTarget,
    { runtimeTarget, applyUpstreamStatus: false, background: !explicit }
  )
  return status?.hasUpstream ? { ahead: status.ahead, behind: status.behind } : null
}

export function createWorkspaceViewReview(notify: () => void) {
  let current: { key: string; pending: boolean; upstream: Upstream | null } | undefined
  function refresh(state: AppState, scope: WorkspaceViewScope, explicit: boolean) {
    if (!scope.git) {
      return
    }
    const { worktree } = scope.git
    const key = JSON.stringify([
      scope.key,
      worktree.head,
      worktree.branch,
      worktree.pushTarget,
      worktree.linkedPR,
      worktree.linkedGitLabMR,
      worktree.linkedBitbucketPR,
      worktree.linkedAzureDevOpsPR,
      worktree.linkedGiteaPR
    ])
    const previous = current?.key === key ? current : undefined
    if (previous && (previous.pending || !explicit)) {
      return
    }
    const request = { key, pending: true, upstream: previous?.upstream ?? null }
    current = request
    void Promise.allSettled([
      refreshWorkspaceViewReview(state, scope.git, explicit),
      refreshUpstream(state, scope.git, scope.hostId, explicit)
    ]).then(([, upstream]) => {
      if (request === current) {
        request.pending = false
        request.upstream = upstream.status === 'fulfilled' ? upstream.value : null
        notify()
      }
    })
    notify()
  }
  return {
    refresh,
    reset() {
      current = undefined
    },
    project(state: AppState, scope: WorkspaceViewScope) {
      if (!scope.git) {
        return null
      }
      refresh(state, scope, false)
      return workspaceViewReview(
        state,
        scope.git,
        current?.pending === true,
        current?.upstream ?? null
      )
    }
  }
}
