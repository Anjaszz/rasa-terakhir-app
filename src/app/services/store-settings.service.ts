import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from './supabase.service';

export interface CustomerPaymentSettings {
  online_payment: boolean;
  cash_payment: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class StoreSettingsService {
  private supabaseService = inject(SupabaseService);

  private paymentSettingsSubject = new BehaviorSubject<CustomerPaymentSettings>({
    online_payment: true,
    cash_payment: true
  });
  public paymentSettings$ = this.paymentSettingsSubject.asObservable();

  constructor() {
    this.loadSettings();
    this.subscribeRealtime();
  }

  get paymentSettings(): CustomerPaymentSettings {
    return this.paymentSettingsSubject.value;
  }

  async loadSettings() {
    const cached = localStorage.getItem('store_payment_settings');
    if (cached) {
      try {
        this.paymentSettingsSubject.next(JSON.parse(cached));
      } catch {}
    }

    if (!this.supabaseService.isConfigured) return;
    try {
      const { data, error } = await this.supabaseService.supabase
        .from('store_settings')
        .select('*')
        .eq('key', 'payment_methods')
        .maybeSingle();

      if (!error && data && data.value) {
        const val: CustomerPaymentSettings = {
          online_payment: data.value.online_payment !== false,
          cash_payment: data.value.cash_payment !== false
        };
        this.paymentSettingsSubject.next(val);
        localStorage.setItem('store_payment_settings', JSON.stringify(val));
      }
    } catch (e) {
      console.warn('Could not load payment settings from Supabase:', e);
    }
  }

  private subscribeRealtime() {
    if (!this.supabaseService.isConfigured) return;
    try {
      this.supabaseService.supabase
        .channel('store-settings-realtime-customer')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'store_settings',
            filter: 'key=eq.payment_methods'
          },
          (payload: any) => {
            if (payload.new && payload.new.value) {
              const val: CustomerPaymentSettings = {
                online_payment: payload.new.value.online_payment !== false,
                cash_payment: payload.new.value.cash_payment !== false
              };
              this.paymentSettingsSubject.next(val);
              localStorage.setItem('store_payment_settings', JSON.stringify(val));
            }
          }
        )
        .subscribe();
    } catch (e) {
      console.warn('Realtime store settings subscription error:', e);
    }
  }
}
