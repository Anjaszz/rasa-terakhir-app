import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonModal } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  searchOutline, closeCircle, add, remove, sparkles, 
  arrowForward, storefrontOutline, bagHandleOutline, checkmarkCircle,
  cartOutline, cart
} from 'ionicons/icons';
import { OrderService, CartItem } from '../../services/order.service';
import { CustomerAuthService } from '../../services/customer-auth.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.page.html',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, IonModal, CommonModule, FormsModule, RouterModule]
})
export class MenuPage implements OnInit, OnDestroy {
  public orderService = inject(OrderService);
  public authService = inject(CustomerAuthService);
  public supabaseService = inject(SupabaseService);

  products: any[] = [];
  filteredProducts: any[] = [];
  categories: string[] = ['Semua'];
  selectedCategory = 'Semua';
  searchQuery = '';
  isLoading = true;

  // Selected Product for Customization Modal
  selectedProduct: any = null;
  isModalOpen = false;
  selectedVariant: any = null;
  selectedToppings: any[] = [];
  modalQty = 1;
  modalNotes = '';

  private productsChannel: any = null;

  constructor() {
    addIcons({ 
      searchOutline, closeCircle, add, remove, sparkles, 
      arrowForward, storefrontOutline, bagHandleOutline, checkmarkCircle,
      cartOutline, cart
    });
  }

  ngOnInit() {
    this.loadProducts();
    this.setupRealtimeProducts();
  }

  ngOnDestroy() {
    if (this.productsChannel) {
      this.supabaseService.supabase.removeChannel(this.productsChannel);
    }
  }

  private setupRealtimeProducts() {
    try {
      this.productsChannel = this.supabaseService.supabase
        .channel('public:products_menu_channel')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'products'
          },
          (payload) => {
            console.log('[Customer App] Products changed in Supabase:', payload);
            this.loadProducts(true);
          }
        )
        .subscribe((status) => {
          console.log('[Customer App] Realtime products subscription status:', status);
        });
    } catch (e) {
      console.warn('Realtime products subscription error:', e);
    }
  }

  async loadProducts(silent = false) {
    if (!silent && this.products.length === 0) {
      this.isLoading = true;
    }
    try {
      const raw = await this.orderService.getMenuProducts();

      // Categorize products by Bahan Baku (components) identically to Cashier POS
      this.products = raw.map(p => {
        const cp = { ...p };
        const isCombo = p.is_bundle === true && p.components && p.components.length > 1;
        cp.display_as_combo = isCombo;

        if (isCombo) {
          cp.category = 'Paket';
        } else if (p.components && p.components.length > 0) {
          // Use the raw material / ingredient name as Category
          cp.category = p.components[0].productName || 'Lainnya';
        } else {
          cp.category = p.variant || 'Lainnya';
        }
        return cp;
      });

      // Extract unique categories
      const catSet = new Set<string>();
      catSet.add('Semua');
      this.products.forEach(p => {
        if (p.category) catSet.add(p.category);
      });

      // Sort: Semua first, alphabetical, then Paket at the end
      this.categories = Array.from(catSet).sort((a, b) => {
        if (a === 'Semua') return -1;
        if (b === 'Semua') return 1;
        if (a === 'Paket') return 1;
        if (b === 'Paket') return -1;
        return a.localeCompare(b);
      });

      this.applyFilter();

      // If modal is open, refresh selectedProduct with new stock info
      if (this.isModalOpen && this.selectedProduct) {
        const updated = this.products.find(p => p.id === this.selectedProduct.id);
        if (updated) {
          this.selectedProduct = updated;
          const max = this.currentModalMaxStock;
          if (this.modalQty > max) {
            this.modalQty = Math.max(1, max);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load menu:', e);
    } finally {
      this.isLoading = false;
    }
  }

  applyFilter() {
    let result = [...this.products];

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q));
    }

    if (this.selectedCategory !== 'Semua') {
      result = result.filter(p => p.category === this.selectedCategory);
    }

    this.filteredProducts = result;
  }

  getVariantStock(product: any, variant: any): number {
    if (!product) return 0;
    const baseStock = product.virtualStock !== undefined ? product.virtualStock : (product.stock || 0);
    const qtyPerItem = variant?.qtyPerItem || variant?.qty_per_item || 1;
    return Math.floor(baseStock / qtyPerItem);
  }

  get currentModalMaxStock(): number {
    return this.getVariantStock(this.selectedProduct, this.selectedVariant);
  }

  selectVariant(v: any) {
    this.selectedVariant = v;
    const max = this.currentModalMaxStock;
    if (this.modalQty > max) {
      this.modalQty = Math.max(1, max);
    }
  }

  openCustomizeModal(product: any) {
    this.selectedProduct = product;
    this.modalNotes = '';
    this.selectedToppings = [];

    // Default variant if available
    if (product.variants && product.variants.length > 0) {
      this.selectedVariant = product.variants[0];
    } else {
      this.selectedVariant = null;
    }

    const max = this.currentModalMaxStock;
    this.modalQty = max > 0 ? 1 : 0;

    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
    this.selectedProduct = null;
  }

  toggleTopping(topping: any) {
    const idx = this.selectedToppings.findIndex(t => t.name === topping.name);
    if (idx > -1) {
      this.selectedToppings.splice(idx, 1);
    } else {
      this.selectedToppings.push(topping);
    }
  }

  isToppingSelected(topping: any): boolean {
    return this.selectedToppings.some(t => t.name === topping.name);
  }

  get calculatedModalPrice(): number {
    if (!this.selectedProduct) return 0;
    let base = this.selectedVariant ? this.selectedVariant.price : this.selectedProduct.price;
    const toppingsTotal = this.selectedToppings.reduce((sum, t) => sum + (t.price || 0), 0);
    return (base + toppingsTotal) * this.modalQty;
  }

  addToCartFromModal() {
    if (!this.selectedProduct) return;
    const maxStock = this.currentModalMaxStock;
    if (maxStock <= 0 || this.modalQty <= 0) return;

    let base = this.selectedVariant ? this.selectedVariant.price : this.selectedProduct.price;
    const toppingsTotal = this.selectedToppings.reduce((sum, t) => sum + (t.price || 0), 0);
    const finalPricePerUnit = base + toppingsTotal;
    const finalQty = Math.min(this.modalQty, maxStock);
    const qtyPerItem = this.selectedVariant?.qtyPerItem || this.selectedVariant?.qty_per_item || 1;

    const item: CartItem = {
      productId: this.selectedProduct.id,
      productName: this.selectedProduct.name,
      variantName: this.selectedVariant ? this.selectedVariant.name : undefined,
      selectedToppings: [...this.selectedToppings],
      basePrice: base,
      price: finalPricePerUnit,
      qty: finalQty,
      qtyPerItem,
      subtotal: finalPricePerUnit * finalQty,
      maxStock,
      photo: this.selectedProduct.photo,
      notes: this.modalNotes.trim()
    };

    this.orderService.addToCart(item);
    this.closeModal();
  }

  formatRupiah(val: number): string {
    return 'Rp ' + (val || 0).toLocaleString('id-ID');
  }
}
