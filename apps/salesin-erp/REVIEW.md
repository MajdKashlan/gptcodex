# SalesIn ERP (Angular + ERPNext) — Code, Functionality & Responsive Review

_Reviewed 2026-11-02. Angular 22, standalone components, signals, ERPNext via same-origin proxy._

**How it was checked:** read all of `src/`, built it (`ng build` ✔), ran unit tests (3/3 ✔), and rendered every
page with mocked ERPNext data at **360px (phone), 820px (tablet), 1440px (desktop)** in **English and Arabic**.

**Overall:** solid foundation. The auth/proxy design (same-origin, `SameSite=Lax` reasoning, CSRF notes), the
lazy routes, the Frappe error parser and the Docker/nginx setup are well thought out. No page overflows
horizontally at any width. The main problems are **data correctness** (lists and totals are silently capped),
**a few broken ERPNext calls**, **duplicated per-page logic**, and **mobile UX of tables/toolbars**.

---

## 🔴 High — bugs that give wrong results or break actions

| # | Where | Problem | Fix |
|---|---|---|---|
| H1 | `orders.service.ts:299` `changeDocumentStatus` | Cancel calls `frappe.client.cancel` with `{doc}`. That method takes `(doctype, name)`, so **Cancel always fails**. (Submit with `{doc}` is fine.) | For cancel send `{ doctype, name }`. Simpler for both: `PUT /api/resource/<doctype>/<name>` with `{docstatus: 1}` / `{docstatus: 2}` like `stock.service` does. |
| H2 | `orders.service.ts:348` `addPayment` | Overwrites `paid_amount`/`received_amount` after `get_payment_entry` — the reference allocation stays at the full outstanding, so partial payments fail validation, and base amounts go out of sync. `payments.service.ts` explicitly documents *not* doing this. | Delete `addPayment` and reuse `PaymentsService.createPayment` (one implementation). |
| H3 | `home-dashboard.service.ts:72` | Dashboard loads only the **100 most recently modified** orders/customers/items. "Total sales", order counts, customer/item counts, top customers and the 90-day trend are all wrong once you pass 100 records. Totals also include **drafts and cancelled** orders. | Use `frappe.client.get_count` for counts; aggregate on the server, e.g. `fields=["transaction_date","sum(grand_total) as total","count(name) as orders"]`, `group_by=transaction_date`, `filters=[["docstatus","=",1],["transaction_date",">=",<90 days ago>]]`. Same idea for top customers (`group_by=customer`). |
| H4 | `home-dashboard.service.ts:102` | "Popular Items" is **always empty**: list endpoints never return child tables, so `order.items` is undefined. | Query `Sales Order Item` (`fields=["item_code","sum(qty) as qty"]`, `group_by=item_code`, filter `docstatus=1`) — needs `parent_doctype=Sales Order` on v15 — or a small whitelisted server method. |
| H5 | Orders, Customers, Items, Stock, Payments | Lists fetch a fixed batch (100–500) and paginate **in the browser**. Records beyond the batch can never be seen; "75 records" is really "first N". Option lists (customers/items/warehouses in `<select>`) are also capped at 500. | Server-side paging: `limit_start=(page-1)*size`, `limit_page_length=size`, plus `frappe.client.get_count` for the total. For pickers use a searchable autocomplete calling `frappe.desk.search.search_link` (`doctype`, `txt`). |
| H6 | `orders.component.ts:521` | Requires Delivery/Due date **strictly after** the order date for every type. ERPNext allows same-day, and same-day due dates are normal for invoices — **cash invoices can't be saved**. | Only block `delivery_date < transaction_date`, and only for Sales Order. |
| H7 | `orders.component.ts:731/737`, `orders.service.ts:314/543`, `payments.component.ts:215`, `stock.component.ts:266`, dashboard trend | "Today" comes from `toISOString()` = **UTC**. In Istanbul (UTC+3) between 00:00–03:00 every document gets **yesterday's date**, and the dashboard trend buckets are shifted. | One helper: `const d = new Date(); return \`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}\``. Display date-only fields with `timeZone: 'UTC'` or as plain strings (the Sales list currently shows "10/28/26, 12:00 AM" for a date-only field). |
| H8 | `erpnext-auth.interceptor.ts:34` | Only **401** triggers logout. An expired Frappe session usually comes back as **403** (request continues as Guest), so after expiry users see "no permission"/empty screens instead of the login page. Worse, almost every list call sets `SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER`, and many services `catchError(() => of([]))`, so expiry and permission errors show as **"no data"**. | On 401/403, call `get_logged_user` once; if it returns Guest/fails → logout + redirect. Stop swallowing errors in list calls — return them and show an error state. |
| H9 | `page-topbar.component.scss` line 1 | File starts with stray text `ok topbar user menu text ok topbar gradient :host {` — it compiles as a bogus selector, so the `:host { display:block; position:relative; z-index:2 }` rule **never applies** (menu stacking can break). | Delete the stray text. |
| H10 | `orders.component.ts` `openEditOrder` / `chooseItem` | Item rate is taken from `Item.standard_rate`, ignoring the selected price list, customer pricing rules and UOM conversion. Prices in the UI can differ from what ERPNext would charge. | On item select call `erpnext.stock.get_item_details.get_item_details` with customer, company, price_list, currency, uom, qty and use its `price_list_rate`/`rate`/`conversion_factor`. |

## 🟠 Medium — architecture & maintainability

1. **No app shell / layout route.** Every page renders `<app-sidebar>` + `<app-page-topbar>`, re-does session restore (already done by `authGuard`), and has its own logout (Home has a confirm dialog + error handling, Orders logs out instantly and ignores errors; the 1-hour idle logout exists **only on the Dashboard**). → Create a `ShellComponent` with `children: [...]` routes; move sidebar, topbar, logout, idle timer and password dialog there; delete per-page `restoreSession` calls.
2. **Duplicate error parsing.** `orders`, `home`, `customers`, `items` each have their own `_server_messages` parser while `core/http/frappe-error.ts` + `NotificationService` exist (NotificationService is used nowhere). → Use `frappeErrorMessage()` / `NotificationService.error()` everywhere.
3. **Duplicate HTTP boilerplate.** Every service repeats `HttpParams` + `fields` JSON + `withCredentials` (already handled by the interceptor) + context. → One `FrappeApiService` with `getList<T>(doctype, {fields, filters, orFilters, orderBy, start, pageLength})`, `getDoc`, `insert`, `update`, `submit`, `cancel`, `delete`, `call(method, args)`, `getCount`.
4. **Giant components.** `orders.component.ts` (755 lines) holds list, filters, 6 dialogs, CSV, PDF, workflow transitions. Split into `sales-list`, `sales-document-dialog`, `sales-toolbar`, `payment-dialog`. Its SCSS also exceeds the 10 kB budget (build warning).
5. **i18n is partial.** Only Stock, Payments and the shell use `i18n.t()`. Login, Dashboard, Sales, Items, Customers are hard-coded English, so Arabic mode shows mixed, badly-ordered text (e.g. "selected / 75 orders 0", ",10/28/26 AM 12:00"). Also `index.html` says `lang="ar" dir="rtl"` while the default language is `en` → direction flash on load.
6. **Hard-coded locale & currency.** `Intl.NumberFormat('en-US', … 'USD')` in Home and Items, `'USD'` fallbacks in orders. → Use the company's `default_currency` and the active language (`ar`/`en`) for number/date formatting.
7. **Native `window.confirm`** in Orders/Stock while other places use custom dialogs → use one `ConfirmDialog` (MatDialog is already installed) — also gives focus trapping, which the hand-made dialogs lack.
8. **Dead links:** Appointments, Reports, B2B, Administration, Feedback, Help use `href="#"` → with `<base href="/">` this navigates to `/` (full reload). Hide them or point to a "coming soon" route.
9. **Unused dependencies:** `chart.js`, `localforage`, `@tanstack/angular-query-experimental` aren't imported anywhere; `escapeHtml()` in orders is unused; `@angular/animations` is deprecated in v22 (`provideAnimationsAsync` → use `animate.enter/leave`).
10. **Items list N+1:** `loadListBarcodes` fetches the **full Item document for each of 100 items** just to read a barcode. → One query with `fields=["name","\`tabItem Barcode\`.barcode"]` or a list on `Item Barcode` with `parent in [...]`.
11. `logout()` only clears local state on success — if the network call fails the user stays "logged in" locally. Clear state in `finalize`.
12. `Mode of Payment` is set after `get_payment_entry`, but `paid_to` (account) isn't updated to that mode's account → payments post to the default account. Fetch the account via `get_bank_cash_account(mode_of_payment, company)`.
13. Tests: only 3 tests. Add unit tests for `frappe-error.ts`, date helpers, pagination, and the dashboard aggregation.

## 📱 Responsive / UI

What's good: no horizontal page overflow at 360/820/1440, dialogs become full-width on phones, `100dvh`, RTL drawer works, reduced-motion respected.

1. **Tables on phones:** Sales (min-width 900px), Items (880), Customers (800), Payments (1000) scroll sideways inside the frame; on a 360px screen you see ~2 columns and lose Customer/Total/Status. → Below ~700px render each row as a **card** (ID + status on top, customer, date, total, actions), or hide secondary columns with `@container`/media queries and keep a sticky first column.
2. **Sales toolbar:** 12 coloured round icon buttons with **no text labels** — users can't tell Status/Type/Assign/Payment/PDF/Excel/Email/Duplicate/Delete apart, and on phones they take 3 rows. → Show only actions valid for the current selection, put the rest in a "More ⋯" menu (`mat-menu`), and add visible labels or at least tooltips + `aria-label`.
3. **Wasted space in search panels** on phone (Items and Payments have a large empty gap before the Search button). → Let the panel grid collapse to `auto` rows; consider search-as-you-type (debounced) instead of a button.
4. **Desktop navigation:** the sidebar is an overlay drawer at every width. On ≥1200px an ERP should keep a **persistent (or collapsible icon-rail) sidebar** — fewer clicks. Use `BreakpointObserver` and `mode="side"` vs `"over"` (`mat-sidenav`).
5. **RTL leftovers:** `text-align: left` in topbar menu, items/customers/orders/payments/stock tables → use `text-align: start`. Check also `translateY` hover on every `button` (sticky hover on touch) — wrap in `@media (hover: hover)`.
6. **Touch targets:** several controls are < 40px (trend range buttons 30px, language toggle 26px). Aim for 44px on touch.
7. **User menu** has no outside-click/Escape close and no focus management.
8. **Fonts:** "Aptos" isn't loaded, so most users get Segoe UI/sans-serif fallback; add a web font with Arabic coverage (e.g. *Noto Sans Arabic* / *IBM Plex Sans Arabic*) for consistent rendering on Android/iOS.
9. Leftover old teal colour `#087f83` (focus ring, chart gradient) — move to `--brand` tokens.

## ✅ Suggested order of work
1. H1, H2, H6, H7, H9 (small, high-impact fixes).
2. H8 + stop swallowing errors.
3. Shell layout route (Medium #1) + shared `FrappeApiService` (#3) + use `NotificationService` (#2).
4. Server-side pagination & searchable pickers (H5), dashboard aggregation (H3, H4), item pricing (H10).
5. Mobile card layout + toolbar menu + persistent desktop sidebar.
6. Finish i18n + locale/currency formatting.
