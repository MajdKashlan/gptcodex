import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, fromEvent, merge, Observable, of, startWith, switchMap, timer } from 'rxjs';
import { ErpNextAuthService } from '../../../core/auth/erpnext-auth.service';
import { ErpNextItem } from '../../../models/item.models';
import { SidebarComponent } from '../../../shared/components/sidebar/sidebar.component';
import { PageTopbarAction, PageTopbarComponent } from '../../../shared/components/page-topbar/page-topbar.component';
import { ErpNextItemDetails, ItemSearchMode, ItemStockLevel, ItemsService } from './items.service';

@Component({
  selector: 'app-items',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
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
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly items = signal<ErpNextItem[]>([]);
  protected readonly categories = signal<string[]>([]);
  protected readonly uoms = signal<string[]>([]);
  protected readonly priceLists = signal<string[]>([]);
  protected readonly selectedCategory = signal<string | null>(null);
  protected readonly searchMode = signal<ItemSearchMode>('either');
  protected readonly selectedNames = signal<Set<string>>(new Set());
  protected readonly selectedItem = computed(() => {
    const [selectedName] = this.selectedNames();
    return this.selectedNames().size === 1
      ? this.items().find((item) => item.name === selectedName) ?? null
      : null;
  });
  protected readonly logoutConfirmationOpen = signal(false);
  protected readonly logoutLoading = signal(false);
  protected readonly newItemOpen = signal(false);
  protected readonly newItemTab = signal<'profile' | 'stock' | 'images'>('profile');
  protected readonly savingItem = signal(false);
  protected readonly editItemOpen = signal(false);
  protected readonly duplicatingItem = signal(false);
  protected readonly editItemTab = signal<'profile' | 'stock' | 'images'>('profile');
  protected readonly loadingEdit = signal(false);
  protected readonly savingEdit = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editItemDetail = signal<ErpNextItemDetails | null>(null);
  protected readonly stockLevels = signal<ItemStockLevel[]>([]);
  protected readonly deleteConfirmationOpen = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly createNotice = signal<string | null>(null);
  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly newItemForm = this.formBuilder.nonNullable.group({
    itemName: ['', Validators.required],
    itemCode: [''],
    barcode: [''],
    itemGroup: ['', Validators.required],
    stockUom: ['', Validators.required],
    salesUom: ['', Validators.required],
    salesUnits: [1, [Validators.required, Validators.min(1)]],
    price: [0, [Validators.required, Validators.min(0.01)]],
    priceList: ['Standard Selling', Validators.required],
    isStockItem: [true],
    imageUrl: [''],
  });
  protected readonly editItemForm = this.formBuilder.nonNullable.group({
    itemCode: ['', Validators.required],
    itemName: ['', Validators.required],
    itemGroup: ['', Validators.required],
    stockUom: ['', Validators.required],
    price: [0, Validators.min(0)],
    priceList: ['Standard Selling', Validators.required],
    barcode: [''],
    isStockItem: [true],
    imageUrl: [''],
  });
  protected readonly editUoms = this.formBuilder.array([this.createUomRow()]);
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

  protected chooseCategoryFromEvent(event: Event): void {
    const category = (event.target as HTMLSelectElement).value;
    this.chooseCategory(category || null);
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
      stockUom: this.uoms()[0] ?? '',
      salesUom: this.uoms()[0] ?? '',
      salesUnits: 1,
      price: 0,
      priceList: this.defaultPriceList(),
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

  protected openEditItem(item = this.selectedItem()): void {
    if (!item) {
      return;
    }

    this.selectedNames.set(new Set([item.name]));
    this.duplicatingItem.set(false);
    this.loadingEdit.set(true);
    this.editError.set(null);
    forkJoin({
      detail: this.itemsService.loadItem(item.name),
      stockLevels: this.itemsService.loadStockLevels(item.item_code),
      sellingPrice: this.itemsService.loadSellingPrice(item.item_code),
    })
      .pipe(finalize(() => this.loadingEdit.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ detail, stockLevels, sellingPrice }) => {
          this.editItemDetail.set(detail);
          this.stockLevels.set(stockLevels);
          this.editItemForm.reset({
            itemCode: detail.item_code,
            itemName: detail.item_name,
            itemGroup: detail.item_group ?? '',
            stockUom: detail.stock_uom,
            price: sellingPrice.price,
            priceList: sellingPrice.priceList,
            barcode: detail.barcodes?.[0]?.barcode ?? '',
            isStockItem: detail.is_stock_item !== 0,
            imageUrl: detail.image ?? '',
          });
          this.editUoms.clear();
          for (const unit of detail.uoms ?? []) {
            if (unit.uom !== detail.stock_uom) {
              this.editUoms.push(this.createUomRow(unit.uom, unit.conversion_factor));
            }
          }
          this.editItemTab.set('profile');
          this.editItemOpen.set(true);
        },
        error: (error: unknown) => this.editError.set(this.createItemError(error)),
      });
  }

  protected closeEditItem(): void {
    if (!this.savingEdit()) {
      this.editItemOpen.set(false);
      this.duplicatingItem.set(false);
    }
  }

  protected updateItem(): void {
    const item = this.editItemDetail();
    if (!item || this.editItemForm.invalid) {
      this.editItemForm.markAllAsTouched();
      return;
    }

    this.savingEdit.set(true);
    this.editError.set(null);
    const formValue = this.editItemForm.getRawValue();
    const uoms = this.editUoms.getRawValue().map((unit) => ({
      uom: unit.uom,
      conversion_factor: unit.conversionFactor,
    }));
    const details = { ...formValue, uoms };
    const save$ = this.duplicatingItem()
      ? this.itemsService.duplicate(item, details)
      : this.itemsService.update(item.name, details);
    save$
      .pipe(finalize(() => this.savingEdit.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.editItemOpen.set(false);
          this.duplicatingItem.set(false);
          this.loadItems();
        },
        error: (error: unknown) => this.editError.set(this.createItemError(error)),
      });
  }

  protected setEditItemTab(tab: 'profile' | 'stock' | 'images'): void {
    this.editItemTab.set(tab);
  }

  protected addSalesUom(): void {
    this.editUoms.push(this.createUomRow());
  }

  protected removeSalesUom(index: number): void {
    this.editUoms.removeAt(index);
  }

  protected confirmDeleteItem(): void {
    this.deleteConfirmationOpen.set(true);
  }

  protected cancelDeleteItem(): void {
    if (!this.savingEdit()) {
      this.deleteConfirmationOpen.set(false);
    }
  }

  protected deleteSelectedItem(): void {
    const item = this.editItemDetail();
    if (!item) {
      return;
    }

    this.savingEdit.set(true);
    this.editError.set(null);
    this.itemsService.delete(item.name)
      .pipe(finalize(() => this.savingEdit.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleteConfirmationOpen.set(false);
          this.editItemOpen.set(false);
          this.selectedNames.set(new Set());
          this.loadItems();
        },
        error: (error: unknown) => {
          this.deleteConfirmationOpen.set(false);
          this.editError.set(this.createItemError(error));
        },
      });
  }

  protected duplicateItem(): void {
    const item = this.editItemDetail();
    if (!item) {
      return;
    }

    this.savingEdit.set(true);
    this.editError.set(null);
    this.itemsService.nextDuplicateCode(item.item_code)
      .pipe(finalize(() => this.savingEdit.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (itemCode) => {
          const currentDetails = this.editItemForm.getRawValue();
          this.editItemForm.reset({
            itemCode,
            itemName: currentDetails.itemName + ' (Copy)',
            itemGroup: currentDetails.itemGroup,
            stockUom: currentDetails.stockUom,
            price: currentDetails.price,
            priceList: currentDetails.priceList,
            barcode: '',
            isStockItem: currentDetails.isStockItem,
            imageUrl: currentDetails.imageUrl,
          });
          this.editUoms.clear();
          for (const unit of item.uoms ?? []) {
            if (unit.uom !== item.stock_uom) {
              this.editUoms.push(this.createUomRow(unit.uom, unit.conversion_factor));
            }
          }
          this.duplicatingItem.set(true);
          this.editItemTab.set('profile');
        },
        error: (error: unknown) => this.editError.set(this.createItemError(error)),
      });
  }

  protected handleTopbarAction(actionId: string): void {
    if (actionId === 'logout') {
      this.signOut();
    }
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
    forkJoin({
      categories: this.itemsService.loadCategories(),
      uoms: this.itemsService.loadUoms(),
      priceLists: this.itemsService.loadPriceLists(),
      items: this.itemsService.search(this.currentSearch()),
    })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ categories, uoms, priceLists, items }) => {
          this.categories.set(categories);
          this.uoms.set(uoms);
          this.priceLists.set(priceLists);
          if (priceLists.length && !priceLists.includes(this.newItemForm.controls.priceList.value)) {
            this.newItemForm.controls.priceList.setValue(this.defaultPriceList());
          }
          if (!this.newItemForm.controls.stockUom.value && uoms.length) {
            this.newItemForm.controls.stockUom.setValue(uoms[0]);
            this.newItemForm.controls.salesUom.setValue(uoms[0]);
          }
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

  private defaultPriceList(): string {
    const priceLists = this.priceLists();
    return priceLists.includes('Standard Selling') ? 'Standard Selling' : priceLists[0] ?? 'Standard Selling';
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
        return 'ERPNext could not complete this item operation. Check the item fields and your permissions.';
      }
    }
    return details.error?.message || 'ERPNext could not complete this item operation. Check the item fields and your permissions.';
  }

  private createUomRow(uom = '', conversionFactor = 1) {
    return this.formBuilder.nonNullable.group({
      uom: [uom, Validators.required],
      conversionFactor: [conversionFactor, [Validators.required, Validators.min(0.000001)]],
    });
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