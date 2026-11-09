# Purchase Planner — نظام تخطيط المشتريات

Windows desktop app (Electron) for monthly demand forecasting and purchase ordering using a **Fixed Order Period** (periodic review / order-up-to) policy.

- 6-month (configurable) moving average and standard deviation
- Dual ABC classification (quantity × sales value) with per-class service level and Z
- Lead time and extra months per item type, per-item overrides, temporary exceptional periods
- Multiple units per item with conversion factors; orders in purchase unit
- Excel import (items, sales, stock, in-transit, legacy workbook) and Excel/PDF export
- Users with roles (admin / purchasing / viewer), edit lock for shared Google Drive folder
- Auto-update from GitHub releases (`gamalelsayed-hub/purchase-planner-releases`)

See [دليل-الاستخدام.md](دليل-الاستخدام.md) for the Arabic user guide.

## Development

```bash
npm install
npm start          # run the app
npm test           # engine unit tests (synthetic data)
npm run test:excel -- <legacy.xlsx> <expected.json>   # parity test against the company Excel workbook (not in repo)
npm run dist       # build Windows installer locally (needs wine on Linux)
```

## Releases

Every push to `main` runs `.github/workflows/build.yml` on `windows-latest`: tests, stamps version `1.0.<run number>`,
builds `PurchasePlanner-Setup.exe`, creates release `build-<n>` here, and — when the repository secret `RELEASES_TOKEN`
is set (token with Contents read/write on `gamalelsayed-hub/purchase-planner-releases`) — publishes the same release to
that public downloads repository. The app checks `releases/latest` of the downloads repository for updates.

Download link: https://github.com/gamalelsayed-hub/purchase-planner-releases/releases/latest/download/PurchasePlanner-Setup.exe
