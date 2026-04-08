# Contributing Guide — ServiceSync Data Pipeline

## Branch Strategy

```
main              ← stable, tested workflows
├── feat/...      ← new workflows or features
├── fix/...       ← bug fixes, workflow errors
├── update/...    ← workflow config changes
└── chore/...     ← docs, repo maintenance
```

## Workflow

```bash
git checkout -b feat/new-audio-filter
# make changes
git add .
git commit -m "feat: add noise reduction to audio filter"
git push -u origin feat/new-audio-filter
# open PR → review → merge
```

## Commit Messages

Format: `type: short description`

| Type | Use |
|------|-----|
| `feat` | New workflow, script, or capability |
| `fix` | Bug fix, workflow error |
| `update` | Config change, threshold tweak |
| `chore` | Docs, cleanup, repo maintenance |

## Rules

1. Branch + PR for all changes — don't push directly to `main`
2. Test workflows locally before pushing
3. No secrets in code — use `.env` or n8n credentials
4. Keep workflow JSONs in `workflows/` with `[Live]` prefix for production
5. Archive old versions in `archive/old-workflows/`

## Devices

| Device | Git Identity | Purpose |
|--------|-------------|---------|
| Frazier's Mac | `servicesync <frazier@servicesync.io>` | Development |
| Beelink (dealership) | `servicesync-beelink <devteam@servicesync.io>` | Data collection |

## Rollback

```bash
# Revert a bad commit
git revert <commit-hash>
git push

# Restore workflow from archive
cp archive/old-workflows/workflow.json workflows/
git add . && git commit -m "fix: restore workflow from archive"
```

## Disaster Recovery

See `backups/2025-12-02_incident/` for the incident report and emergency restore script.
