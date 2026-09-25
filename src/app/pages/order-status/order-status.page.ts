import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { IonContent, IonHeader, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  checkmarkCircle, timeOutline, qrCodeOutline, receiptOutline, 
  arrowBack, logoWhatsapp, shareSocialOutline, storefrontOutline,
  bagHandleOutline, restaurantOutline, closeCircle, cardOutline,
  refresh, alertCircle, walletOutline
} from 'ionicons/icons';
import { CustomerDbService, LocalOrder } from '../../services/customer-db.service';
import { SupabaseService } from '../../services/supabase.service';
import { MidtransService } from '../../services/midtrans.service';
import { OrderService } from '../../services/order.service';

@Component({
  selector: 'app-order-status',
  templateUrl: './order-status.page.html',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, CommonModule, RouterModule]
})
export class OrderStatusPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private dbService = inject(CustomerDbService);
  private supabaseService = inject(SupabaseService);
  public midtransService = inject(MidtransService);
  public orderService = inject(OrderService);

  trxCode = '';
  order: LocalOrder | null = null;
  isLoading = true;
  isPaying = false;
  paymentErrorMessage = '';
  private realtimeChannel: any = null;

  constructor() {
    addIcons({
      checkmarkCircle, timeOutline, qrCodeOutline, receiptOutline,
      arrowBack, logoWhatsapp, shareSocialOutline, storefrontOutline,
      bagHandleOutline, restaurantOutline, closeCircle, cardOutline,
      refresh, alertCircle, walletOutline
    });
  }

  ngOnInit() {
    this.trxCode = this.route.snapshot.paramMap.get('code') || '';
    if (this.trxCode) {
      this.loadOrder();
      this.initRealtime();
    }
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabaseService.supabase.removeChannel(this.realtimeChannel);
    }
  }

  private initRealtime() {
    if (!this.supabaseService.isConfigured || !this.trxCode) return;
    try {
      this.realtimeChannel = this.supabaseService.supabase
        .channel(`order-status-${this.trxCode}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'transactions',
            filter: `trx_code=eq.${this.trxCode}`
          },
          (payload) => {
            if (this.order && payload.new) {
              this.order.status = (payload.new as any).status;
              this.dbService.updateOrderStatus(this.trxCode, this.order.status);
            }
          }
        )
        .subscribe();
    } catch (e) {
      console.warn('Realtime status subscription warning:', e);
    }
  }

  async loadOrder() {
    this.isLoading = true;
    try {
      // 1. Check local DB first
      const local = await this.dbService.getLocalOrderByCode(this.trxCode);
      if (local) {
        this.order = local;
      }

      // 2. Fetch live status from Supabase
      const { data } = await this.supabaseService.supabase
        .from('transactions')
        .select('*')
        .eq('trx_code', this.trxCode)
        .maybeSingle();

      if (data) {
        this.order = {
          trxCode: data.trx_code,
          queueNumber: data.queue_number,
          date: new Date(data.date),
          total: data.total,
          items: data.items || [],
          paymentMethod: data.payment_method,
          customerName: data.customer_name,
          customerPhone: data.customer_phone,
          orderType: data.order_type || 'take_away',
          status: data.status || 'pending',
          isGuest: !data.customer_id
        };
      }
    } catch (e) {
      console.error('Error fetching order status:', e);
    } finally {
      this.isLoading = false;
    }
  }

  async payNow() {
    if (!this.order || this.isPaying) return;
    this.isPaying = true;
    this.paymentErrorMessage = '';

    try {
      const snapReq = {
        orderId: this.order.trxCode,
        grossAmount: this.order.total,
        customerName: this.order.customerName || 'Pelanggan',
        customerPhone: this.order.customerPhone || '',
        customerEmail: '',
        items: this.order.items.map(i => ({
          id: i.productId || 1,
          price: i.price,
          quantity: i.qty,
          name: i.productName || i.name || 'Menu'
        }))
      };

      const snapToken = await this.midtransService.createSnapToken(snapReq);
      if (!snapToken) {
        throw new Error('Gagal mendapatkan token pembayaran Midtrans');
      }

      const payResult = await this.midtransService.openSnapPayment(snapToken);
      if (payResult.status === 'success') {
        await this.orderService.updateOrderPaymentSuccess(this.order.trxCode, this.order.total);
        this.order.status = 'pending';
      }
    } catch (e: any) {
      this.paymentErrorMessage = e?.message || 'Gagal memproses pembayaran';
    } finally {
      this.isPaying = false;
    }
  }

  async cancelOrder() {
    if (!this.order) return;
    if (confirm('Apakah Anda yakin ingin membatalkan pesanan ini?')) {
      await this.orderService.cancelOrder(this.order.trxCode);
      this.order.status = 'cancelled';
    }
  }

  contactAdminWhatsApp() {
    if (!this.order) return;
    const adminPhone = '6285774122651';
    const text = `Halo Admin MyKasir, saya ingin menanyakan pesanan saya:\n\n*No. Antrean:* #${this.order.queueNumber}\n*Kode Transaksi:* ${this.order.trxCode}\n*Nama Pemesan:* ${this.order.customerName || '-'}\n*Total:* ${this.formatRupiah(this.order.total)}\n\nMohon info status pesanannya ya, terima kasih!`;
    const url = `https://wa.me/${adminPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  async completeOrder() {
    if (!this.order) return;
    try {
      await this.supabaseService.supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('trx_code', this.order.trxCode);

      this.order.status = 'completed';
      await this.dbService.updateOrderStatus(this.order.trxCode, 'completed');
    } catch (e) {
      console.warn('Gagal menyelesaikan pesanan:', e);
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + (val || 0).toLocaleString('id-ID');
  }
}
