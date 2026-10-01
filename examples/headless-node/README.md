# Headless Node example

```sh
pnpm install && pnpm build
pnpm --filter @contactpatch/example-headless-node start
```

Loads the core, adds the RWD sports car preset, accelerates for ten seconds
with a steering input after four, and prints speed, lateral g, and the state
hash once per second. The same script produces the same hashes on every
machine.
