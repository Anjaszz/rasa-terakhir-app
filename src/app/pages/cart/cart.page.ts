import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IonContent, IonHeader, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  trashOutline, add, remove, arrowBack, checkmarkCircle, 
  qrCodeOutline, cashOutline, storefrontOutline, bagHandleOutline, 
  bicycleOutline, personOutline, logoWhatsapp, mailOutline,
  cardOutline, walletOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { OrderService, CartItem } from '../../services/order.service';
import { CustomerAuthService } from '../../services/customer-auth.service';
import { MidtransService } from '../../services/midtrans.service';
import { StoreSettingsService } from '../../services/store-settings.service';

@Component({
  selector: 'app-cart',
  templateUrl: './cart.page.html',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, CommonModule, FormsModule, RouterModule]
})
export class CartPage implements OnInit {
  public orderService = inject(OrderService);
  public authService = inject(CustomerAuthService);
  public midtransService = inject(MidtransService);
  public storeSettingsService = inject(StoreSettingsService);
  private router = inject(Router);

  // Form Fields
  customerName = '';
  customerPhone = '';
  customerEmail = '';
  paymentMethod: 'midtrans' | 'cash' = 'midtrans';
  orderType: 'take_away' | 'delivery' = 'take_away';
  
  isSubmitting = false;
  loadingStep = 'Memproses pesanan...';
  errorMessage = '';

  constructor() {
    addIcons({
      trashOutline, add, remove, arrowBack, checkmarkCircle,
      qrCodeOutline, cashOutline, storefrontOutline, bagHandleOutline,
      bicycleOutline, personOutline, logoWhatsapp, mailOutline,
      cardOutline, walletOutline, shieldCheckmarkOutline
    });
  }

  ngOnInit() {
    this.initCustomerData();
    this.storeSettingsService.paymentSettings$.subscribe(settings => {
      if (settings) {
        if (!settings.online_payment && settings.cash_payment && this.paymentMethod === 'midtrans') {
          this.paymentMethod = 'cash';
        } else if (!settings.cash_payment && settings.online_payment && this.paymentMethod === 'cash') {
          this.paymentMethod = 'midtrans';
        }
      }
    });
  }

  initCustomerData() {
    const user = this.authService.currentUser;
    if (user) {
      this.customerName = user.name || '';
      this.customerPhone = user.whatsapp || '';
      this.customerEmail = user.email || '';
    }
  }

  setOrderType(type: 'take_away' | 'delivery') {
    this.orderType = type;
    this.orderService.setOrderType(type);
  }

  onQtyInputChange(index: number, event: any) {
    const rawVal = event.target.value;
    const val = parseInt(rawVal, 10);
    if (isNaN(val) || val <= 0) {
      this.orderService.updateQty(index, 1);
      event.target.value = 1;
    } else {
      this.orderService.updateQty(index, val);
      const currentItem = this.orderService.cart[index];
      if (currentItem) {
        event.target.value = currentItem.qty;
      }
    }
  }

  async submitOrder() {
    this.errorMessage = '';

    if (!this.customerName.trim()) {
      this.errorMessage = 'Harap isi nama pemesan';
      return;
    }

    if (!this.customerPhone.trim()) {
      this.errorMessage = 'Harap isi nomor WhatsApp/HP untuk info pesanan';
      return;
    }

    if (this.orderService.cart.length === 0) {
      this.errorMessage = 'Keranjang belanja masih kosong';
      return;
    }

    this.isSubmitting = true;
    this.loadingStep = 'Menyiapkan pesanan & memotong stok...';

    try {
      // If guest, remember guest details in auth service
      if (!this.authService.isLoggedIn) {
        this.authService.setGuestUser(this.customerName.trim(), this.customerPhone.trim(), this.customerEmail.trim());
      }

      // 1. Place order in database
      const order = await this.orderService.placeOrder(this.paymentMethod, {
        name: this.customerName.trim(),
        phone: this.customerPhone.trim(),
        email: this.customerEmail.trim()
      });

      // 2. If Payment Method is Midtrans, trigger Midtrans Snap Payment
      if (this.paymentMethod === 'midtrans') {
        this.loadingStep = 'Menghubungkan ke Midtrans Snap Payment...';

        const snapReq = {
          orderId: order.trxCode,
          grossAmount: order.total,
          customerName: this.customerName.trim(),
          customerPhone: this.customerPhone.trim(),
          customerEmail: this.customerEmail.trim(),
          items: order.items.map(i => ({
            id: i.productId,
            price: i.price,
            quantity: i.qty,
            name: i.productName
          }))
        };

        const snapToken = await this.midtransService.createSnapToken(snapReq);
        if (snapToken) {
          this.loadingStep = 'Membuka popup pembayaran...';
          const payResult = await this.midtransService.openSnapPayment(snapToken);
          if (payResult.status === 'success') {
            this.loadingStep = 'Memverifikasi pembayaran...';
            await this.orderService.updateOrderPaymentSuccess(order.trxCode, order.total);
          }
        }
      }

      this.router.navigate(['/order-status', order.trxCode]);
    } catch (e: any) {
      this.errorMessage = e?.message || 'Gagal memproses pesanan';
    } finally {
      this.isSubmitting = false;
    }
  }

  formatRupiah(val: number): string {
    return 'Rp ' + (val || 0).toLocaleString('id-ID');
  }
}
