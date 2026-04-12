"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import Script from "next/script";
import { 
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, 
  Tooltip, XAxis, YAxis 
} from "recharts";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { 
  ShoppingCart, LayoutDashboard, Package, Users, 
  LogOut, Plus, Trash2, CheckCircle, FileDown 
} from "lucide-react";

// --- Types ---
type Role = "owner" | "admin" | "user";

type Product = {
  id: string;
  name: string;
  type: string;
  duration: string;
  price: number;
  cost: number;
  active: boolean;
};

type OrderRecord = {
  id: string;
  user_id: string;
  name: string;
  service: string;
  type: string;
  duration: string;
  price: number;
  cost: number;
  profit: number;
  payment_phone: string | null;
  whatsapp_number: string | null;
  screenshot_url: string | null;
  status: string;
  notes: string | null;
  date: string;
  created_at: string;
};

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
};

type CartItem = {
  productId: string;
  quantity: number;
};

export default function CRMPage() {
  // --- State ---
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [orderForm, setOrderForm] = useState({ 
    customerName: "", paymentPhone: "", whatsappNumber: "", 
    screenshotDataUrl: "", notes: "" 
  });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productForm, setProductForm] = useState({ 
    name: "", type: "full", duration: "1 Month", price: 0, cost: 0, active: true 
  });

  // --- Refs ---
  const captchaToken = useRef<string | null>(null);

  // --- Helpers ---
  const role = profile?.role || "user";
  const isAdmin = role === "admin" || role === "owner";

  const shopProducts = useMemo(
    () => products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  const cartItems = useMemo(
    () => cart
      .map((item) => ({ ...item, product: shopProducts.find((p) => p.id === item.productId) }))
      .filter((item): item is CartItem & { product: Product } => Boolean(item.product)),
    [cart, shopProducts]
  );

  const cartTotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const cartCost = cartItems.reduce((sum, item) => sum + item.product.cost * item.quantity, 0);
  const cartProfit = cartTotal - cartCost;

  const revenue = orders.reduce((sum, order) => sum + order.price, 0);
  const cost = orders.reduce((sum, order) => sum + order.cost, 0);
  const profit = revenue - cost;

  const monthlyData = useMemo(() => {
    const map = new Map<string, { month: string; revenue: number; cost: number; profit: number }>();
    orders.forEach((order) => {
      const dateValue = new Date(order.date);
      const month = Number.isNaN(dateValue.getTime()) ? "Unknown" : dateValue.toLocaleString("en-US", { month: "short", year: "numeric" });
      const existing = map.get(month) ?? { month, revenue: 0, cost: 0, profit: 0 };
      existing.revenue += order.price;
      existing.cost += order.cost;
      existing.profit += order.profit;
      map.set(month, existing);
    });
    return Array.from(map.values());
  }, [orders]);

  function notify(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }

  // --- Auth Handlers ---
  useEffect(() => {
    if (!supabase) return;
    async function getInitialSession() {
      const { data } = await supabase!.auth.getSession();
      setUser(data.session?.user ?? null);
    }
    getInitialSession();
    
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !supabase) {
      setProfile(null);
      setLoading(false);
      return;
    }
    async function loadData() {
      setLoading(true);
      const { data: profileData, error } = await supabase!
        .from("users")
        .select("*")
        .eq("id", user.id)
        .single();
      
      let currentProfile = profileData;
      if (!profileData || error) {
        const { data: newData } = await supabase!
          .from("users")
          .upsert({ id: user.id, email: user.email, role: "user" })
          .select()
          .single();
        currentProfile = newData;
      }
      setProfile(currentProfile);
      
      const isUserAdmin = currentProfile?.role === "admin" || currentProfile?.role === "owner";
      await fetchOrders(isUserAdmin, user.id);
      await fetchProducts();
      if (isUserAdmin) await fetchUsers();
      setLoading(false);
    }
    loadData();
  }, [user]);

  async function fetchOrders(adminStatus: boolean, userId: string) {
    if (!supabase) return;
    const query = adminStatus ? supabase.from("customers").select("*") : supabase.from("customers").select("*").eq("user_id", userId);
    const { data } = await query.order("created_at", { ascending: false });
    if (data) setOrders(data.map(o => ({ ...o, price: Number(o.price), cost: Number(o.cost), profit: Number(o.profit) })));
  }

  async function fetchProducts() {
    if (!supabase) return;
    const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (data) setProducts(data);
  }

  async function fetchUsers() {
    if (!supabase) return;
    const { data } = await supabase.from("users").select("*");
    if (data) setUsers(data);
  }

  async function handleLogin(mode: "signIn" | "signUp") {
    if (!supabase) return;

    // الحصول على التوكين من الـ Ref أو من الـ DOM مباشرة كخطة احتياطية
    const token = captchaToken.current || (document.querySelector("[name='h-captcha-response']") as HTMLInputElement)?.value;
    
    if (!token) {
      notify("Please complete the captcha verification");
      return;
    }

    try {
      const verify = await fetch("/api/verify-hcaptcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await verify.json();

      if (!result.success) {
        notify("Captcha verification failed. Please try again.");
        (window as any).hcaptcha?.reset();
        return;
      }
    } catch (e) {
      notify("Error connecting to captcha service");
      return;
    }

    const { error } = mode === "signIn"
      ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
      : await supabase.auth.signUp({ email: authForm.email, password: authForm.password });

    if (error) notify(error.message);
    else notify(mode === "signIn" ? "Logged In Successfully" : "Check your email to verify");
  }

  // --- Business Logic ---
  async function handleConfirmOrder() {
    if (!supabase) return;
    if (cartItems.length === 0 || !orderForm.screenshotDataUrl) {
      return notify("Please add products and upload payment proof");
    }

    try {
      notify("Processing order...");
      const res = await fetch(orderForm.screenshotDataUrl);
      const blob = await res.blob();
      const fileName = `${user.id}/${Date.now()}_screenshot.png`;
      const file = new File([blob], fileName, { type: "image/png" });

      const { error: uploadError } = await supabase.storage.from('orders_images').upload(fileName, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('orders_images').getPublicUrl(fileName);
      const publicImageUrl = urlData.publicUrl;

      const payload = {
        user_id: user.id,
        name: orderForm.customerName || user.email,
        service: cartItems.map(i => `${i.product.name} x${i.quantity}`).join(", "),
        type: cartItems[0]?.product.type || "full",
        duration: cartItems.map(i => i.product.duration).join(", "),
        price: cartTotal,
        cost: cartCost,
        profit: cartProfit,
        payment_phone: orderForm.paymentPhone,
        whatsapp_number: orderForm.whatsappNumber,
        screenshot_url: publicImageUrl,
        status: "pending",
        date: new Date().toISOString().split("T")[0]
      };

      const { error: dbError } = await supabase.from("customers").insert(payload);
      if (dbError) throw dbError;

      setCart([]);
      setOrderForm({ customerName: "", paymentPhone: "", whatsappNumber: "", screenshotDataUrl: "", notes: "" });
      notify("Order Submitted Successfully ✅");
      fetchOrders(isAdmin, user.id);
    } catch (error: any) {
      notify("Error: " + error.message);
    }
  }

  async function handleCreateProduct() {
    if (!supabase) return;
    if (!productForm.name || productForm.price <= 0) return notify("Invalid product data");
    const { error } = await supabase.from("products").insert(productForm);
    if (!error) {
      setProductForm({ name: "", type: "full", duration: "1 Month", price: 0, cost: 0, active: true });
      fetchProducts();
      notify("Product Added");
    }
  }

  async function handleToggleProductActive(id: string, active: boolean) {
    if (!supabase) return;
    await supabase.from("products").update({ active }).eq("id", id);
    fetchProducts();
  }

  async function handleDeleteProduct(id: string) {
    if (!supabase) return;
    await supabase.from("products").delete().eq("id", id);
    fetchProducts();
  }

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.text("Sales Report", 10, 10);
    orders.forEach((o, i) => doc.text(`${o.name} - ${o.service} - ${o.price} TND`, 10, 20 + (i * 10)));
    doc.save("report.pdf");
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(orders);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, "orders.xlsx");
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-950 text-white font-mono">LOADING_SYSTEM...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-4 md:p-8 font-sans" dir="ltr">
      <Script src="https://js.hcaptcha.com/1/api.js" strategy="afterInteractive" />

      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <LayoutDashboard className="text-cyan-400" /> Admin Store
            </h1>
            <p className="text-slate-400 mt-1">Digital Services Management</p>
          </div>
          {user && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold">{user.email}</p>
                <span className="text-xs text-cyan-400 uppercase tracking-widest">{role}</span>
              </div>
              <button onClick={() => supabase?.auth.signOut()} className="p-2 rounded-full bg-slate-800 hover:bg-red-500/20 text-red-400 transition">
                <LogOut size={20} />
              </button>
            </div>
          )}
        </header>

        {notification && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-cyan-500 px-6 py-3 text-slate-950 font-bold shadow-2xl animate-in fade-in zoom-in duration-300">
            {notification}
          </div>
        )}

        {!user ? (
          <section className="max-w-md mx-auto rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl mt-20">
            <h2 className="text-2xl font-bold mb-6 text-center">Authentication</h2>
            <div className="space-y-4">
              <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 outline-none focus:border-cyan-400 transition" placeholder="Email" onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
              <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 outline-none focus:border-cyan-400 transition" placeholder="Password" type="password" onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
              
              <div className="flex justify-center my-4 min-h-[78px]">
                <div 
                  className="h-captcha" 
                  data-sitekey="2fc8db30-c3aa-48e6-9c3c-22a89f9cd89e"
                  data-callback={(token: string) => { captchaToken.current = token; }}
                ></div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <button onClick={() => handleLogin("signIn")} className="rounded-2xl bg-cyan-500 py-4 font-bold text-slate-950 hover:bg-cyan-400 transition">Sign In</button>
                <button onClick={() => handleLogin("signUp")} className="rounded-2xl border border-slate-700 py-4 hover:bg-slate-800 transition">Register</button>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Stats */}
            <section className="grid gap-6 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6 shadow-sm">
                <p className="text-slate-400 text-sm">Revenue</p>
                <p className="text-3xl font-bold mt-2 text-white">{revenue.toFixed(2)} <span className="text-sm">TND</span></p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6 shadow-sm">
                <p className="text-slate-400 text-sm">Expenses</p>
                <p className="text-3xl font-bold mt-2 text-white">{cost.toFixed(2)} <span className="text-sm">TND</span></p>
              </div>
              <div className="rounded-3xl border border-cyan-900/50 bg-slate-900/50 p-6 shadow-sm border-b-cyan-500">
                <p className="text-slate-400 text-sm">Net Profit</p>
                <p className="text-3xl font-bold mt-2 text-cyan-400">{profit.toFixed(2)} <span className="text-sm">TND</span></p>
              </div>
            </section>

            <div className="grid gap-8 lg:grid-cols-2">
              {/* Shopping Section */}
              <section className="space-y-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Package className="text-cyan-400" /> Store
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {shopProducts.map((p) => (
                    <div key={p.id} className="group rounded-3xl border border-slate-800 bg-slate-900/40 p-5 hover:border-cyan-500/50 transition">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-lg">{p.name}</h3>
                          <p className="text-sm text-slate-500">{p.duration}</p>
                        </div>
                        <span className="bg-cyan-500/10 text-cyan-400 px-3 py-1 rounded-full text-sm font-bold">{p.price} TND</span>
                      </div>
                      <button onClick={() => {
                        const existing = cart.find(i => i.productId === p.id);
                        if (existing) setCart(cart.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
                        else setCart([...cart, { productId: p.id, quantity: 1 }]);
                        notify("Added to cart");
                      }} className="mt-6 w-full rounded-2xl bg-slate-800 py-3 text-sm font-bold group-hover:bg-cyan-500 group-hover:text-slate-950 transition">
                        Add to Cart
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Cart Section */}
              <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <ShoppingCart className="text-cyan-400" /> Checkout
                </h2>
                {cartItems.length === 0 ? (
                  <div className="py-20 text-center text-slate-500 border-2 border-dashed border-slate-800 rounded-3xl">Cart is empty</div>
                ) : (
                  <div className="space-y-4">
                    {cartItems.map(item => (
                      <div key={item.productId} className="flex items-center justify-between bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                        <div>
                          <p className="font-bold">{item.product.name}</p>
                          <p className="text-xs text-slate-500">{item.quantity} x {item.product.price} TND</p>
                        </div>
                        <button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} className="text-red-400 p-2 hover:bg-red-400/10 rounded-xl transition">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                    <div className="pt-4 border-t border-slate-800">
                      <div className="flex justify-between text-xl font-bold">
                        <span>Total:</span>
                        <span className="text-cyan-400">{cartTotal.toFixed(2)} TND</span>
                      </div>
                    </div>
                    <div className="space-y-4 pt-4">
                      <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 outline-none" placeholder="Customer Name" value={orderForm.customerName} onChange={e => setOrderForm({...orderForm, customerName: e.target.value})} />
                      <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 outline-none" placeholder="Phone Number" value={orderForm.paymentPhone} onChange={e => setOrderForm({...orderForm, paymentPhone: e.target.value})} />
                      <div className="relative">
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-700 rounded-2xl cursor-pointer hover:bg-slate-800/50 transition">
                          <Plus className="text-slate-500 mb-2" />
                          <p className="text-sm text-slate-500">Upload Receipt Screenshot</p>
                          <input type="file" className="hidden" accept="image/*" onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = () => setOrderForm({...orderForm, screenshotDataUrl: String(reader.result)});
                              reader.readAsDataURL(file);
                            }
                          }} />
                        </label>
                        {orderForm.screenshotDataUrl && <div className="mt-2 text-green-400 text-xs font-bold text-center">✓ Attachment Ready</div>}
                      </div>
                      <button onClick={handleConfirmOrder} className="w-full rounded-2xl bg-cyan-500 py-4 font-bold text-slate-950 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] transition">
                        Confirm Purchase
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Admin Panel */}
            {isAdmin && (
              <section className="space-y-8 pt-12 border-t border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="h-8 w-1 bg-cyan-500 rounded-full"></div>
                  <h2 className="text-3xl font-bold">Administration</h2>
                </div>
                
                <div className="grid gap-8 xl:grid-cols-2">
                  {/* Chart */}
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
                    <h3 className="text-xl font-bold mb-6">Performance</h3>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="month" stroke="#94a3b8" />
                          <YAxis stroke="#94a3b8" />
                          <Tooltip contentStyle={{backgroundColor: '#0f172a', borderRadius: '16px', border: '1px solid #1e293b'}} />
                          <Bar dataKey="profit" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Profit" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  
                  {/* Add Product */}
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
                    <h3 className="text-xl font-bold mb-6">Manage Services</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <input value={productForm.name} className="rounded-xl bg-slate-950 border border-slate-800 p-3" placeholder="Service Name" onChange={e => setProductForm({...productForm, name: e.target.value})} />
                      <input value={productForm.price || ''} className="rounded-xl bg-slate-950 border border-slate-800 p-3" placeholder="Selling Price" type="number" onChange={e => setProductForm({...productForm, price: Number(e.target.value)})} />
                      <input value={productForm.cost || ''} className="rounded-xl bg-slate-950 border border-slate-800 p-3" placeholder="Cost Price" type="number" onChange={e => setProductForm({...productForm, cost: Number(e.target.value)})} />
                      <select value={productForm.duration} className="rounded-xl bg-slate-950 border border-slate-800 p-3" onChange={e => setProductForm({...productForm, duration: e.target.value})}>
                        {["1 Month", "3 Months", "6 Months", "12 Months"].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <button onClick={handleCreateProduct} className="sm:col-span-2 rounded-xl bg-cyan-500 text-slate-950 font-bold py-3 hover:bg-cyan-400 transition">Save Service</button>
                    </div>
                    
                    <div className="mt-8 max-h-[200px] overflow-y-auto space-y-2">
                      {products.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                          <span className={p.active ? "text-white" : "text-slate-600 line-through"}>{p.name}</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleToggleProductActive(p.id, !p.active)} className={`text-xs px-2 py-1 rounded-lg ${p.active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {p.active ? "ON" : "OFF"}
                            </button>
                            <button onClick={() => handleDeleteProduct(p.id)} className="text-slate-500 hover:text-red-400 transition"><Trash2 size={16} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Orders Management */}
                <div className="grid gap-8 xl:grid-cols-2">
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold">Recent Transactions</h3>
                      <div className="flex gap-2">
                        <button onClick={exportPdf} className="p-2 bg-slate-800 rounded-xl hover:text-cyan-400 transition"><FileDown size={20} /></button>
                        <button onClick={exportExcel} className="p-2 bg-slate-800 rounded-xl hover:text-green-400 transition"><Package size={20} /></button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {orders.slice(0, 10).map(o => (
                        <div key={o.id} className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800 flex justify-between items-center">
                          <div className="text-left">
                            <p className="font-bold">{o.name}</p>
                            <p className="text-xs text-slate-500">{o.service}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-cyan-400">{o.price} TND</p>
                            <span className="text-[10px] bg-slate-800 px-2 py-1 rounded-full uppercase tracking-tighter">{o.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Users */}
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6">
                    <h3 className="text-xl font-bold mb-6">User Permissions</h3>
                    <div className="space-y-4">
                      {users.map(u => (
                        <div key={u.id} className="flex items-center justify-between bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                          <p className="text-sm truncate max-w-[150px]">{u.email}</p>
                          <select 
                            value={u.role} 
                            disabled={u.id === user.id && role !== 'owner'} 
                            onChange={async (e) => {
                              if (!supabase) return;
                              const { error } = await supabase.from("users").update({ role: e.target.value }).eq("id", u.id);
                              if (!error) { fetchUsers(); notify("Permissions updated"); }
                            }} 
                            className="bg-slate-800 text-xs rounded-lg px-2 py-1 outline-none border-none cursor-pointer"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="mt-20 text-center text-slate-600 pb-10 text-sm">
        <p>© 2026 Admin Store Portal - System Active</p>
      </footer>
    </div>
  );
}
