import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';

interface QuickAction {
  title: string;
  description: string;
  symbol: string;
}

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatCardModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);

  protected readonly userName = computed(() => this.auth.currentUser() ?? 'there');
  protected readonly today = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  protected readonly quickActions: QuickAction[] = [
    { title: 'New sales order', description: 'Create an order for a customer', symbol: '+' },
    { title: 'Customers', description: 'Find and manage customer accounts', symbol: '◎' },
    { title: 'Item catalog', description: 'Browse inventory and pricing', symbol: '□' },
  ];

  protected signOut(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
