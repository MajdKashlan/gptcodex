import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((module) => module.HomeComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/authentication/login/login.component').then(
        (module) => module.LoginComponent,
      ),
  },
  {
    path: 'items',
    loadComponent: () =>
      import('./features/catalog/items/items.component').then((module) => module.ItemsComponent),
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/customers/customers.component').then((module) => module.CustomersComponent),
  },
  {
    path: 'sales',
    loadComponent: () =>
      import('./features/orders/orders.component').then((module) => module.OrdersComponent),
  },
  { path: 'catalog', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: 'login' },
];
