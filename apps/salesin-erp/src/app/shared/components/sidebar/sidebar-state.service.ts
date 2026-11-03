import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SidebarStateService {
  private readonly visible = signal(false);
  readonly isOpen = this.visible.asReadonly();

  toggle(): void {
    this.visible.update((open) => !open);
  }

  close(): void {
    this.visible.set(false);
  }
}
