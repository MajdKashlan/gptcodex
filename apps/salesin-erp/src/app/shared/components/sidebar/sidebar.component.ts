import { Component, computed, DestroyRef, HostListener, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { SidebarStateService } from './sidebar-state.service';

interface SalesLink {
  view: string;
  label: string;
}

/**
 * Main navigation.
 *
 * - **Docked** (wide screens): always visible beside the content.
 * - **Drawer** (phones/tablets): slides over the content, with a backdrop.
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  host: {
    '[class.is-open]': 'sidebarState.isOpen()',
    '[class.docked]': 'docked()',
  },
})
export class SidebarComponent {
  readonly userName = input.required<string>();
  readonly userImage = input<string | null>(null);
  readonly docked = input(false);
  readonly signOut = output<void>();

  private readonly router = inject(Router);
  protected readonly sidebarState = inject(SidebarStateService);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());
  protected readonly salesExpanded = signal(this.router.url.startsWith('/sales'));
  protected readonly visible = computed(() => this.docked() || this.sidebarState.isOpen());

  protected readonly salesLinks: SalesLink[] = [
    { view: 'all', label: 'All Sales' },
    { view: 'quotes', label: 'Quotes' },
    { view: 'orders', label: 'Orders' },
    { view: 'customer-orders', label: 'Customer Orders' },
    { view: 'invoices', label: 'Invoices' },
    { view: 'credit-notes', label: 'Credit Notes' },
  ];

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((event) => {
        if (event.urlAfterRedirects.startsWith('/sales')) this.salesExpanded.set(true);
      });
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.sidebarState.close();
  }

  protected navigated(): void {
    if (!this.docked()) this.sidebarState.close();
  }
}
