# claude-mods

Mods for Claude Code: changes to its interface and behavior, each in its own folder under `plugins/`. This repository is a plugin marketplace, so each mod installs with one command.

## Mods

| Mod | What it does |
|---|---|
| [`usage-band`](plugins/usage-band) | Adds one row above the prompt with three horizontal bars: the context window, coloured by category as `/context` colours it, the 5-hour limit and the weekly limit. Each limit shows when it resets. Hover over the row to see the tokens of each category. |

## Install

At the prompt of a terminal session:

```
/plugin install usage-band --marketplace via-justa/claude-mods
```

From a shell:

```sh
claude plugin install usage-band --marketplace via-justa/claude-mods
```

In the desktop app, click + next to the prompt box, then Plugins. Add the marketplace `via-justa/claude-mods`, then add the plugin.

When managed settings set `strictKnownMarketplaces`, add `{ "source": "github", "repo": "via-justa/claude-mods" }` to that list first.

## Develop a mod

Run a session with the mod loaded from its folder:

```sh
claude --plugin-dir plugins/<mod>
```

Check and test it:

```sh
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
