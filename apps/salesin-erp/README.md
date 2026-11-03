# SalesIn ERP

A modern, responsive sales & inventory front end (Angular 22) for an **ERPNext** backend,
inspired by SalesIn. Works on phones, tablets and desktops.

## Features

| Area | What you can do |
|---|---|
| Dashboard | Sales this month, open orders, receivables, 90-day trend, top customers, popular items (all aggregated by ERPNext) |
| Sales | Quotes, orders, invoices, credit notes, customer orders · server-side paging & search · create/edit drafts with ERPNext pricing · submit / cancel / delete · assign · payments · PDF · CSV · Quote → Order → Invoice → Credit note |
| Sales document page | Full document with lines, taxes, totals, billing/delivery progress, related documents (orders, invoices, returns, payments), print & PDF |
| Customers | Paged list, create/edit with contact & address, customer page with balances (outstanding, overdue, billed) and all their documents |
| Items | Paged catalogue with barcode, stock and selling price · create / edit / duplicate / delete · units of sale |
| Stock | Stock levels, movements, stock entries (receipt / issue / transfer) with submit / cancel |
| Payments | Outstanding invoices, aging by customer, record payments (mode of payment → correct account) |
| Reports | Sales by month, by customer, by item, receivables aging, stock value by warehouse · date presets · CSV export |

## Project structure

```
src/app/
  core/
    api/frappe-api.service.ts    ← the only place that talks to ERPNext REST
    auth/                        ← session login, guard, 401/403 expiry handling
    context/app-context.service  ← companies & default currency (cached)
    http/                        ← credentials/CSRF interceptor, error parsing, toasts
    utils/                       ← local-date helpers, money formatting, CSV
  shared/
    layout/shell.component       ← sidebar + top bar + account actions + idle sign-out
    components/                  ← sidebar, top bar, pager, link-input (searchable link field), confirm dialog
    pipes/format.pipes.ts        ← appDate, money, qty
  features/                      ← home, orders (sales), sales-document, customers, catalog/items, stock, payments, reports
```

Conventions:

- Lists are **paged on the server** (`limit_start` + a count query); never "load 500 and slice".
- Totals are **aggregated by ERPNext** (`sum()/count()` + `group_by`) in company currency.
- Dates use `todayIso()` / `appDate` (local calendar dates; never `toISOString().slice(0, 10)`).
- Pickers for customers, items, users use `<app-link-input>` (ERPNext `search_link`).
- Errors: `frappeErrorMessage(error)` inline, `NotificationService` for toasts. List calls don't swallow errors.
- Tables use `class="data-table"` + `data-label` on each `<td>`; below 760px they become cards.

## Development

```bash
npm install
npm start          # https://localhost:4200 (proxies /api to ERPNext, see proxy.conf.json)
npm test           # Vitest unit tests
npm run build      # production build in dist/
```

To remove the browser trust warning on Windows, run
`Import-Certificate -FilePath ssl/localhost.cer -CertStoreLocation Cert:\CurrentUser\Root` in PowerShell.

Deployment (Docker / nginx / aaPanel) is described in [DEPLOY.md](DEPLOY.md).

## ERPNext permissions

The app uses the signed-in user's ERPNext roles. Typical needs: read on Company, Customer, Item,
Item Price, Bin, Warehouse, Price List; read/write on Quotation, Sales Order, Sales Invoice,
Payment Entry, Stock Entry, Customer, Item, Contact, Address. Figures a role cannot read are
hidden with a notice instead of showing as zero.
