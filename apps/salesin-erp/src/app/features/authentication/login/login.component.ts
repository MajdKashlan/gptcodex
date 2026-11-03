import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HttpErrorResponse } from '@angular/common/http';
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
export class LoginComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly mode = signal<LoginMode>('password');
  protected readonly loading = signal(false);
  protected readonly checkingSession = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly tokenForm = this.formBuilder.nonNullable.group({
    apiKey: ['', Validators.required],
    apiSecret: ['', Validators.required],
  });

  protected readonly passwordForm = this.formBuilder.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  ngOnInit(): void {
    // The route guard has already tried to restore an existing session, so the
    // form can be shown straight away.
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl(this.returnUrl());
      return;
    }
    this.checkingSession.set(false);
  }

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
      next: () => void this.router.navigateByUrl(this.returnUrl()),
      error: (error: unknown) => this.errorMessage.set(this.authenticationErrorMessage(error)),
    });
  }

  /** Only same-app paths are accepted, so the parameter cannot redirect off-site. */
  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login') ? url : '/';
  }

  private authenticationErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 0 || error.status === 403)) {
      return 'ERPNext did not establish a usable login session. Check the HTTPS API proxy and try again.';
    }

    return 'Authentication was not accepted. Check your details and ERPNext permissions.';
  }
}
