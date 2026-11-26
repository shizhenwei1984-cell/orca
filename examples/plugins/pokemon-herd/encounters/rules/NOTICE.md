# Upstream encounter rules

The JavaScript in this directory comes from the `mods/pokemon-herd` directory of [herdr-pokemon at 11f949d](https://github.com/lntvan166/herdr-pokemon/tree/11f949d97dee013d636c4fa1baf7fc55a5f20627/mods/pokemon-herd).
It is distributed under the [upstream MIT license](../../LICENSE-upstream) by mathieucroset and lntvan166.

The Orca port applies repository formatting and lint fixes, passes the injected random source to spar move effects, and samples trainer teams without replacement so repeated random values can produce distinct teammates.
The exchange in [battle.js](../battle.js) and encounter transitions adapt the rules in the upstream `main.js`.
