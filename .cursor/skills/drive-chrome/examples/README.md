# Examples

Each file is a JSON array of steps ready to pipe into `cdp.mjs`. Launch Chrome first with the
launch script in the parent folder.

| File | Shows |
|---|---|
| `navigate-and-snapshot.json` | The minimum useful run: navigate, wait for load, read the page structure. |
| `locators.json` | One of each locator strategy (`role`+`name`, implicit roles, `fill`, `press`, scoped `snapshot`). |
| `multi-tab.json` | Any step file can target a specific tab; run it as `node cdp.mjs "<url substring>"`. |

PowerShell:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content .\navigate-and-snapshot.json -Raw | node ..\cdp.mjs
```

Bash:

```bash
node ../cdp.mjs < navigate-and-snapshot.json
```
