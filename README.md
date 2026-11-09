# Purchase Planner — نظام تخطيط المشتريات

Windows desktop app (Electron) for monthly demand forecasting and purchase ordering using a **Fixed Order Period** (periodic review / order-up-to) policy.

- 6-month (configurable) moving average and standard deviation
- Dual ABC classification (quantity × sales value) with per-class service level and Z
- Lead time and extra months per item type, per-item overrides, temporary exceptional periods
- Multiple units per item with conversion factors; orders in purchase unit
- Excel import (items, sales, stock, in-transit, legacy workbook) and Excel/PDF export
- Users with roles (admin / purchasing / viewer), edit lock for shared Google Drive folder
- Update check from a shared folder (`latest.json`)

See [دليل-الاستخدام.md](دليل-الاستخدام.md) for the Arabic user guide.

## Development

```bash
npm install
npm start          # run the app
npm test -- <legacy.xlsx> <expected.json>   # engine parity test against the Excel workbook
npm run dist       # build Windows installer + zip (needs wine on Linux)
```
