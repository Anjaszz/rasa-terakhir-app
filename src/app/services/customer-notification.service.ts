import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SupabaseService } from './supabase.service';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerDbService } from './customer-db.service';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CustomerNotificationService {
  private supabaseService = inject(SupabaseService);
  private authService = inject(CustomerAuthService);
  private dbService = inject(CustomerDbService);
  private toastCtrl = inject(ToastController);
  private router = inject(Router);

  private orderStatusChangedSubject = new BehaviorSubject<any>(null);
  public orderStatusChanged$ = this.orderStatusChangedSubject.asObservable();

  private realtimeChannel: any = null;

  constructor() {
    this.initRealtimeWatcher();
  }

  public initRealtimeWatcher() {
    if (!this.supabaseService.isConfigured) return;

    try {
      const supabase = this.supabaseService.supabase;
      
      if (this.realtimeChannel) {
        supabase.removeChannel(this.realtimeChannel);
      }

      this.realtimeChannel = supabase
        .channel('customer-orders-realtime-listener')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'transactions'
          },
          async (payload) => {
            const updated = payload.new as any;
            if (!updated || !updated.trx_code) return;

            await this.handleOrderUpdate(updated);
          }
        )
        .subscribe((status) => {
          console.log('[Customer App] Realtime notification status:', status);
        });
    } catch (e) {
      console.warn('[Customer App] Failed to subscribe to realtime order notifications:', e);
    }
  }

  private async handleOrderUpdate(updatedTrx: any) {
    const trxCode = updatedTrx.trx_code;
    const newStatus = updatedTrx.status;
    const currentUserId = this.authService.currentUser?.id;

    // Check if this transaction belongs to this customer (either by local Dexie or member ID)
    const localOrder = await this.dbService.getLocalOrderByCode(trxCode);
    const isOwner = (localOrder !== undefined) || (currentUserId && updatedTrx.customer_id === currentUserId);

    if (!isOwner) return;

    // Check if status actually changed
    const previousStatus = localOrder?.status;
    if (previousStatus === newStatus) return;

    // Update local database
    await this.dbService.updateOrderStatus(trxCode, newStatus);
    this.orderStatusChangedSubject.next(updatedTrx);

    // Trigger alert sound & vibration
    this.playNotificationSound();
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {}

    // Show Toast Notification based on new status
    await this.showStatusToast(updatedTrx, newStatus);
  }

  private async showStatusToast(order: any, status: string) {
    let message = '';
    let color: 'primary' | 'success' | 'warning' | 'danger' | 'tertiary' = 'primary';
    let icon = 'notifications-outline';

    switch (status) {
      case 'processing':
        message = `👨‍🍳 Pesanan #${order.queue_number} (${order.trx_code}) telah DITERIMA & sedang disiapkan!`;
        color = 'primary';
        icon = 'restaurant-outline';
        break;
      case 'ready':
        message = `🛍️ Hore! Pesanan #${order.queue_number} (${order.trx_code}) SUDAH SIAP DIAMBIL!`;
        color = 'tertiary';
        icon = 'bag-handle-outline';
        break;
      case 'completed':
        message = `✅ Pesanan #${order.queue_number} telah SELESAI. Terima kasih & selamat menikmati!`;
        color = 'success';
        icon = 'checkmark-circle';
        break;
      case 'cancelled':
        message = `❌ Pesanan #${order.queue_number} Dibatalkan/Ditolak oleh kasir.`;
        color = 'danger';
        icon = 'close-circle';
        break;
      default:
        message = `🔔 Status Pesanan #${order.queue_number} diperbarui: ${status}`;
    }

    try {
      const toast = await this.toastCtrl.create({
        message,
        duration: 5000,
        position: 'top',
        color,
        cssClass: 'custom-customer-toast',
        buttons: [
          {
            text: 'Lihat',
            role: 'info',
            handler: () => {
              this.router.navigate(['/order-status', order.trx_code]);
            }
          },
          {
            text: '✕',
            role: 'cancel'
          }
        ]
      });
      await toast.present();
    } catch (e) {
      console.warn('Could not show toast:', e);
    }
  }

  private playNotificationSound() {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.15); // G5
      osc.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.3); // C6

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {}
  }
}
