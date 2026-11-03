import { Routes } from '@angular/router';
import { authGuard, redirectIfAuthenticated } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · SalesIn',
    canActivate: [redirectIfAuthenticated],
    loadComponent: () =>
      import('./features/authentication/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shared/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Dashboard',
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'sales',
        title: 'Sales',
        loadComponent: () => import('./features/orders/orders.component').then((m) => m.OrdersComponent),
      },
      {
        path: 'sales/:doctype/:name',
        title: 'Sales Document',
        loadComponent: () =>
          import('./features/sales-document/sales-document.component').then((m) => m.SalesDocumentComponent),
      },
      {
        path: 'customers',
        title: 'Customers',
        loadComponent: () =>
          import('./features/customers/customers.component').then((m) => m.CustomersComponent),
      },
      {
        path: 'customers/:name',
        title: 'Customer',
        loadComponent: () =>
          import('./features/customers/customer-detail.component').then((m) => m.CustomerDetailComponent),
      },
      {
        path: 'items',
        title: 'Items',
        loadComponent: () =>
          import('./features/catalog/items/items.component').then((m) => m.ItemsComponent),
      },
      {
        path: 'stock',
        title: 'Stock',
        loadComponent: () => import('./features/stock/stock.component').then((m) => m.StockComponent),
      },
      {
        path: 'payments',
        title: 'Payments & Collections',
        loadComponent: () =>
          import('./features/payments/payments.component').then((m) => m.PaymentsComponent),
      },
      {
        path: 'reports',
        title: 'Reports',
        loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent),
      },
      { path: 'catalog', pathMatch: 'full', redirectTo: 'items' },
    ],
  },
  { path: '**', redirectTo: '' },
];
