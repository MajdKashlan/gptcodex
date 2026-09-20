import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { ErpNextAuthService } from '../../../core/auth/erpnext-auth.service';

type LoginMode = 'api-token' | 'password';

@Component({
  selector: 'app-login',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);

  protected readonly mode = signal<LoginMode>('api-token');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly tokenForm = this.formBuilder.nonNullable.group({
    apiKey: ['', Validators.required],
    apiSecret: ['', Validators.required],
  });

  protected readonly passwordForm = this.formBuilder.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected selectMode(mode: LoginMode): void {
    this.mode.set(mode);
    this.errorMessage.set(null);
  }

  protected submit(): void {
    const form = this.mode() === 'api-token' ? this.tokenForm : this.passwordForm;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    const request =
      this.mode() === 'api-token'
        ? this.auth.loginWithApiToken(this.tokenForm.getRawValue())
        : this.auth.loginWithPassword(this.passwordForm.getRawValue());

    request.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: () => void this.router.navigate(['/catalog']),
      error: () =>
        this.errorMessage.set(
          'Authentication was not accepted. Check your details and ERPNext permissions.',
        ),
    });
  }
}
