---
title: ccswitch rename / remove
description: Rename or delete profiles
---

## Synopsis

```
ccswitch rename <from> <to>
ccswitch remove <name>
```

## Description

**`ccswitch rename`** renames a profile, including its secrets in the keychain, isolated config directory (if any), and the active pointer (if it's the current profile).

**`ccswitch remove`** deletes a profile, its stored secrets, and its isolated config directory.

## Examples

```bash
ccswitch rename work work-old
ccswitch remove work-old
```

## Related

- [ccswitch list](/docs/commands/list) — see all profiles
