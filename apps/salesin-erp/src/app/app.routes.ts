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
  { path: 'catalog', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: 'login' },
];
