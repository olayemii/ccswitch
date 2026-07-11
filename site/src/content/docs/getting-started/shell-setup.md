---
title: Shell setup (ccuse)
description: Set up the ccuse shell helper for per-shell switching
---

The `ccuse` command is a shell function that wraps `ccswitch env`. Add this to your shell profile (`.zshrc`, `.bashrc`, etc.):

```bash
eval "$(ccswitch shellinit)"
```

Then restart your shell or source the file:

```bash
source ~/.zshrc
```

## What it does

`ccswitch shellinit` prints:

```bash
ccuse() {
  if [ "$1" = "--unset" ]; then eval "$(ccswitch env --unset)"; return; fi
  eval "$(ccswitch env "$1")"
}
```

## Usage

```bash
ccuse work           # activate 'work' profile in this shell
ccuse bedrock-prod   # activate 'bedrock-prod' in this shell
ccuse --unset        # clear all profile env vars
```

Each shell is independent — you can have `work` in one terminal and `personal` in another.
