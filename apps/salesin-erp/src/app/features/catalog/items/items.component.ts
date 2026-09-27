import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, fromEvent, merge, Observable, of, startWith, switchMap, timer } from 'rxjs';
import { ErpNextAuthService } from '../../../core/auth/erpnext-auth.service';
import { ErpNextItem } from '../../../models/item.models';
import { SidebarComponent } from '../../../shared/components/sidebar/sidebar.component';
import { ItemSearchMode, ItemsService } from './items.service';

@Component({
  selector: 'app-items',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent],
  templateUrl: './items.component.html',
  styleUrl: './items.component.scss',
})
export class ItemsComponent implements OnInit {
  private static readonly idleTimeoutMs = 60 * 60 * 1000;
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly itemsService = inject(ItemsService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());
  protected readonly userMenuOpen = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly items = signal<ErpNextItem[]>([]);
  protected readonly categories = signal<string[]>([]);
  protected readonly selectedCategory = signal<string | null>(null);
  protected readonly searchMode = signal<ItemSearchMode>('either');
  protected readonly selectedNames = signal<Set<string>>(new Set());
  protected readonly logoutConfirmationOpen = signal(false);
  protected readonly logoutLoading = signal(false);
  protected readonly newItemOpen = signal(false);
  protected readonly newItemTab = signal<'profile' | 'stock' | 'images'>('profile');
  protected readonly savingItem = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly createNotice = signal<string | null>(null);
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly newItemForm = this.formBuilder.nonNullable.group({
    itemName: ['', Validators.required],
    itemCode: [''],
    barcode: [''],
    itemGroup: ['', Validators.required],
    stockUom: ['Nos', Validators.required],
    salesUom: ['Nos', Validators.required],
    salesUnits: [1, [Validators.required, Validators.min(1)]],
    price: [0, [Validators.required, Validators.min(0.01)]],
    priceList: ['Standard Selling', Validators.required],
    isStockItem: [true],
    imageUrl: [''],
  });
  protected readonly allSelected = computed(() =>
    this.items().length > 0 && this.items().every((item) => this.selectedNames().has(item.name)),
  );

  ngOnInit(): void {
    const session$: Observable<unknown> = this.auth.isAuthenticated()
      ? of(null)
      : this.auth.restoreSession();

    session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.startIdleLogoutTimer();
        this.loadCatalog();
      },
      error: () => void this.router.navigate(['/login']),
    });
  }

  protected search(): void {
    this.loadItems();
  }

  protected chooseCategory(category: string | null): void {
    this.selectedCategory.set(category);
    this.loadItems();
  }

  protected refresh(): void {
    this.loadCatalog();
  }

  protected openNewItem(): void {
    this.createError.set(null);
    this.createNotice.set(null);
    this.newItemTab.set('profile');
    this.newItemForm.reset({
      itemName: '',
      itemCode: '',
      barcode: '',
      itemGroup: this.categories()[0] ?? '',
      stockUom: 'Nos',
      salesUom: 'Nos',
      salesUnits: 1,
      price: 0,
      priceList: 'Standard Selling',
      isStockItem: true,
      imageUrl: '',
    });
    this.newItemOpen.set(true);
  }

  protected closeNewItem(): void {
    if (!this.savingItem()) {
      this.newItemOpen.set(false);
    }
  }

  protected setNewItemTab(tab: 'profile' | 'stock' | 'images'): void {
    this.newItemTab.set(tab);
  }

  protected createItem(): void {
    if (this.newItemForm.invalid) {
      this.newItemForm.markAllAsTouched();
      this.newItemTab.set('profile');
      return;
    }

    this.savingItem.set(true);
    this.createError.set(null);
    this.createNotice.set(null);
    this.itemsService.create(this.newItemForm.getRawValue())
      .pipe(finalize(() => this.savingItem.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ priceWarning }) => {
          this.newItemOpen.set(false);
          this.selectedCategory.set(null);
          this.searchText.setValue('');
          this.loadItems();
          if (priceWarning) {
            this.createNotice.set('Item created, but its selling price could not be saved. Check the selected price list and permissions.');
          }
        },
        error: (error: unknown) => this.createError.set(this.createItemError(error)),
      });
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected toggleAll(): void {
    this.selectedNames.set(this.allSelected() ? new Set() : new Set(this.items().map((item) => item.name)));
  }

  protected toggleItem(name: string): void {
    this.selectedNames.update((selection) => {
      const updated = new Set(selection);
      if (updated.has(name)) {
        updated.delete(name);
      } else {
        updated.add(name);
      }
      return updated;
    });
  }

  protected setSearchMode(mode: ItemSearchMode): void {
    this.searchMode.set(mode);
  }

  protected formatPrice(price: number | undefined): string {
    return price == null
      ? 'N/A'
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);
  }

  protected signOut(): void {
    this.userMenuOpen.set(false);
    this.logoutConfirmationOpen.set(true);
  }

  protected cancelSignOut(): void {
    if (!this.logoutLoading()) {
      this.logoutConfirmationOpen.set(false);
    }
  }

  protected confirmSignOut(): void {
    this.logoutLoading.set(true);
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => {
        this.logoutLoading.set(false);
        this.error.set('Could not log out from ERPNext. Check your connection and try again.');
      },
    });
  }

  private loadCatalog(): void {
    this.loading.set(true);
    forkJoin({ categories: this.itemsService.loadCategories(), items: this.itemsService.search(this.currentSearch()) })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ categories, items }) => {
          this.categories.set(categories);
          this.items.set(items);
          this.error.set(null);
          this.selectedNames.set(new Set());
        },
        error: () => this.error.set('Items could not be loaded. Check your ERPNext permissions.'),
      });
  }

  private loadItems(): void {
    this.loading.set(true);
    this.itemsService.search(this.currentSearch())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.items.set(items);
          this.selectedNames.set(new Set());
          this.error.set(null);
        },
        error: () => this.error.set('Items could not be loaded. Check your ERPNext permissions.'),
      });
  }

  private currentSearch() {
    return {
      category: this.selectedCategory(),
      query: this.searchText.value,
      mode: this.searchMode(),
    };
  }

  private createItemError(error: unknown): string {
    const details = error as { error?: { _server_messages?: string; message?: string } };
    const serverMessages = details.error?._server_messages;
    if (serverMessages) {
      try {
        const entries = JSON.parse(serverMessages) as string[];
        for (const entry of entries) {
          const message = (JSON.parse(entry) as { message?: string }).message;
          if (message) {
            return message.replace(/<[^>]+>/g, '');
          }
        }
      } catch {
        return 'ERPNext could not create this item. Check the required fields and your permissions.';
      }
    }
    return details.error?.message || 'ERPNext could not create this item. Check the required fields and your permissions.';
  }

  private startIdleLogoutTimer(): void {
    merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'pointermove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'wheel'),
      fromEvent(document, 'touchstart'),
    )
      .pipe(
        startWith(null),
        switchMap(() => timer(ItemsComponent.idleTimeoutMs)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.auth.logout().subscribe({
        next: () => void this.router.navigate(['/login']),
        error: () => this.error.set('Your session expired, but ERPNext could not complete logout.'),
      }));
  }
}