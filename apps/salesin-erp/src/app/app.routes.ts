import { Routes } from '@angular/router';
import { authGuard, redirectIfAuthenticated } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/home/home.component').then((module) => module.HomeComponent),
  },
  {
    path: 'login',
    canActivate: [redirectIfAuthenticated],
    loadComponent: () =>
      import('./features/authentication/login/login.component').then(
        (module) => module.LoginComponent,
      ),
  },
  {
    path: 'items',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/catalog/items/items.component').then((module) => module.ItemsComponent),
  },
  {
    path: 'customers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customers/customers.component').then((module) => module.CustomersComponent),
  },
  {
    path: 'sales',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/orders/orders.component').then((module) => module.OrdersComponent),
  },
  {
    path: 'stock',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/stock/stock.component').then((module) => module.StockComponent),
  },
  {
    path: 'payments',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/payments/payments.component').then((module) => module.PaymentsComponent),
  },
  { path: 'catalog', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: 'login' },
];
