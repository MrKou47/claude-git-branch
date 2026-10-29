# git-branch

A Claude Code mod that keeps the workspace's git state in view.

- **Prompt footer** (terminal and desktop, right-hand side): `⎇ <branch>` followed by `↓n` (behind upstream), `↑n` (ahead), `●n` (changed files), or `✓` when clean and up to date, in VS Code's git colours, plus how far the local main branch is behind `origin`, and icon actions:
  - **⤓ Pull branch**: `git pull --rebase --autostash`, so local commits are replayed on top and no merge commit is made.
  - **⌂ Update main**: fast-forwards the local main branch (`git fetch origin main:main`, or a pull when you are on main).
  - **↻ Fetch**: `git fetch --prune origin` and refresh.
- **Slash commands**: `/git-pull` and `/git-update-main` do the same as the buttons.

State refreshes every 10 s, after each Bash call and each turn; `origin` is fetched at session start and every 5 minutes. Neither action creates a merge commit; uncommitted work is stashed and restored around the rebase.

## Install

At the prompt of a terminal session:

```
/plugin install git-branch --marketplace MrKou47/claude-git-branch
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

From a shell:

```bash
claude plugin install git-branch --marketplace MrKou47/claude-git-branch
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `MrKou47/claude-git-branch`, then Add plugin.

## Develop

```bash
claude plugin validate .
claude plugin test .
```
