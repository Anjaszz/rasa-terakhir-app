import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';

export interface MidtransPaymentItem {
  id: string | number;
  price: number;
  quantity: number;
  name: string;
}

export interface MidtransPaymentRequest {
  orderId: string;
  grossAmount: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  items: MidtransPaymentItem[];
}

export interface MidtransPaymentResult {
  status: 'success' | 'pending' | 'error' | 'closed';
  result?: any;
}

declare global {
  interface Window {
    snap?: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class MidtransService {
  private supabaseService = inject(SupabaseService);
  private isLoaded = false;
  private loadPromise: Promise<boolean> | null = null;

  constructor() {
    this.loadSnapScript();
  }

  /**
   * Load Midtrans Snap Script asynchronously
   */
  public loadSnapScript(): Promise<boolean> {
    if (this.isLoaded && window.snap) {
      return Promise.resolve(true);
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve) => {
      const clientKey = (environment as any).midtransClientKey || 'SB-Mid-client-6CGa60nWIQAPV2ct';
      const snapUrl = (environment as any).midtransSnapUrl || 'https://app.sandbox.midtrans.com/snap/snap.js';

      const existingScript = document.getElementById('midtrans-snap-script');
      if (existingScript) {
        this.isLoaded = true;
        resolve(true);
        return;
      }

      const script = document.createElement('script');
      script.id = 'midtrans-snap-script';
      script.src = snapUrl;
      script.setAttribute('data-client-key', clientKey);
      script.async = true;

      script.onload = () => {
        this.isLoaded = true;
        console.log('[Midtrans] Snap SDK loaded successfully with client key:', clientKey);
        resolve(true);
      };

      script.onerror = (err) => {
        console.warn('[Midtrans] Failed to load Snap SDK script:', err);
        resolve(false);
      };

      document.body.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * Generate Snap Token:
   * 1. Primary: Via Supabase Backend Function (Zero CORS, 100% Secure)
   * 2. Fallback: Via Local Dev Server Proxy
   */
  public async createSnapToken(req: MidtransPaymentRequest): Promise<string | null> {
    // 1. Primary Method: Supabase Backend RPC (Zero CORS everywhere)
    try {
      const supabase = this.supabaseService.supabase;
      const { data, error } = await supabase.rpc('create_midtrans_token', {
        order_id: req.orderId,
        gross_amount: Math.round(req.grossAmount),
        customer_name: req.customerName,
        customer_phone: req.customerPhone,
        customer_email: req.customerEmail || null
      });

      let resObj = data;
      if (typeof resObj === 'string') {
        try {
          resObj = JSON.parse(resObj);
        } catch (e) {
          // ignore
        }
      }

      if (!error && resObj && resObj.token) {
        console.log('[Midtrans] Snap Token received via Supabase Backend RPC:', resObj.token);
        return resObj.token;
      }
      if (error) {
        console.warn('[Midtrans] Supabase RPC notice:', error.message);
      }
    } catch (e) {
      console.warn('[Midtrans] Supabase RPC error:', e);
    }

    // 2. Fallback Method: Local Dev Proxy
    const serverKey = (environment as any).midtransServerKey;
    if (serverKey) {
      try {
        const authHeader = 'Basic ' + btoa(serverKey.trim() + ':');
        const payload = {
          transaction_details: {
            order_id: req.orderId,
            gross_amount: Math.round(req.grossAmount)
          },
          customer_details: {
            first_name: req.customerName,
            phone: req.customerPhone,
            email: req.customerEmail || undefined
          },
          item_details: req.items.map(i => ({
            id: String(i.id).substring(0, 50),
            price: Math.round(i.price),
            quantity: i.quantity,
            name: (i.name || 'Menu').substring(0, 50)
          }))
        };

        const response = await fetch('/midtrans-api/snap/v1/transactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const resJson = await response.json();
          if (resJson && resJson.token) {
            console.log('[Midtrans] Snap Token received via Local Dev Proxy:', resJson.token);
            return resJson.token;
          }
        }
      } catch (err) {
        console.warn('[Midtrans] Local proxy fallback failed:', err);
      }
    }

    return null;
  }

  /**
   * Trigger Midtrans Snap Payment Popup
   */
  public async openSnapPayment(snapToken: string): Promise<MidtransPaymentResult> {
    await this.loadSnapScript();

    return new Promise((resolve) => {
      if (!window.snap || typeof window.snap.pay !== 'function') {
        console.warn('[Midtrans] Snap JS is not available');
        resolve({ status: 'error', result: { message: 'Midtrans SDK tidak tersedia' } });
        return;
      }

      window.snap.pay(snapToken, {
        onSuccess: (result: any) => {
          console.log('[Midtrans] Payment Success:', result);
          resolve({ status: 'success', result });
        },
        onPending: (result: any) => {
          console.log('[Midtrans] Payment Pending:', result);
          resolve({ status: 'pending', result });
        },
        onError: (result: any) => {
          console.error('[Midtrans] Payment Error:', result);
          resolve({ status: 'error', result });
        },
        onClose: () => {
          console.log('[Midtrans] Customer closed payment modal.');
          resolve({ status: 'closed' });
        }
      });
    });
  }

  public get isConfigured(): boolean {
    const key = (environment as any).midtransClientKey;
    return !!key && key.startsWith('SB-Mid-client-') && key !== 'SB-Mid-client-demo-key';
  }

  public get clientKey(): string {
    return (environment as any).midtransClientKey || '';
  }

  public get serverKey(): string {
    return (environment as any).midtransServerKey || '';
  }
}
