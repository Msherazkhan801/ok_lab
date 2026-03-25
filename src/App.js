import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Helper functions (same as before)
const saveToLocalStorage = (key, data) => localStorage.setItem(key, JSON.stringify(data));
const loadFromLocalStorage = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : defaultValue;
};

// Generate bill number
const generateBillNumber = (existingBills) => {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const lastBill = existingBills
    .filter(b => b.billNumber.startsWith(`BL-${today}`))
    .sort((a,b) => b.billNumber.localeCompare(a.billNumber))[0];
  let nextNum = 1;
  if (lastBill) {
    const lastNum = parseInt(lastBill.billNumber.split('-').pop(), 10);
    nextNum = lastNum + 1;
  }
  return `BL-${today}-${String(nextNum).padStart(3,'0')}`;
};

// Check expiry and low stock
const isExpired = (expiryDate) => new Date(expiryDate) < new Date();
const isLowStock = (quantity, threshold = 10) => quantity <= threshold && quantity > 0;

// ---------- Main App ----------
function App() {
  const [medicines, setMedicines] = useState([]);
  const [sales, setSales] = useState([]);
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddMedicineModal, setShowAddMedicineModal] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState(null);
  const [showSellModal, setShowSellModal] = useState(false);
  const [selectedMedicineForSell, setSelectedMedicineForSell] = useState(null);
  const [showCreateSaleModal, setShowCreateSaleModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedSaleForReceipt, setSelectedSaleForReceipt] = useState(null);

  // Load data from localStorage
  useEffect(() => {
    const savedMedicines = loadFromLocalStorage('medicines', [
      { id: 'MED001', medicineName: 'Paracetamol 500mg', genericName: 'Acetaminophen', quantity: 250, expiryDate: '2026-12-31', price: 2.50 },
      { id: 'MED002', medicineName: 'Amoxicillin 250mg', genericName: 'Amoxicillin', quantity: 45, expiryDate: '2025-08-15', price: 5.00 },
      { id: 'MED003', medicineName: 'Vitamin C 1000mg', genericName: 'Ascorbic Acid', quantity: 0, expiryDate: '2024-12-01', price: 8.75 },
    ]);
    const savedSales = loadFromLocalStorage('sales', []);
    setMedicines(savedMedicines);
    setSales(savedSales);
  }, []);

  useEffect(() => {
    saveToLocalStorage('medicines', medicines);
  }, [medicines]);
  useEffect(() => {
    saveToLocalStorage('sales', sales);
  }, [sales]);

  // Medicine CRUD
  const addMedicine = (medicine) => {
    const newId = `MED${String(medicines.length + 1).padStart(3,'0')}`;
    setMedicines([...medicines, { ...medicine, id: newId }]);
  };

  const updateMedicine = (id, updatedData) => {
    setMedicines(medicines.map(m => m.id === id ? { ...m, ...updatedData } : m));
  };

  const deleteMedicine = (id) => {
    const isUsed = sales.some(sale => sale.items.some(item => item.medicineId === id));
    if (isUsed) {
      alert('Cannot delete: this medicine is used in existing sales.');
      return;
    }
    setMedicines(medicines.filter(m => m.id !== id));
  };

  // Sell a single medicine (quick sell)
  const sellMedicine = (medicine, quantitySold) => {
    if (quantitySold <= 0 || quantitySold > medicine.quantity) {
      alert(`Invalid quantity. Stock: ${medicine.quantity}`);
      return;
    }
    const newQuantity = medicine.quantity - quantitySold;
    updateMedicine(medicine.id, { quantity: newQuantity });
    const newSale = {
      id: Date.now(),
      billNumber: generateBillNumber(sales),
      date: new Date().toISOString().slice(0,10),
      customerName: 'Walk-in Customer',
      items: [{
        medicineId: medicine.id,
        medicineName: medicine.medicineName,
        quantity: quantitySold,
        price: medicine.price,
        subtotal: medicine.price * quantitySold
      }],
      totalAmount: medicine.price * quantitySold,
      paymentMethod: 'Cash'
    };
    setSales([...sales, newSale]);
    setSelectedSaleForReceipt(newSale);
    setShowReceiptModal(true);
    alert(`Sold ${quantitySold} of ${medicine.medicineName}. Remaining stock: ${newQuantity}`);
  };

  // Create a multi-item sale
  const createSale = (saleData) => {
    const newId = Date.now();
    const newSale = {
      ...saleData,
      id: newId,
      billNumber: generateBillNumber(sales),
      date: new Date().toISOString().slice(0,10),
    };
    setSales([...sales, newSale]);
    // Update stock
    const updatedMedicines = [...medicines];
    saleData.items.forEach(item => {
      const index = updatedMedicines.findIndex(m => m.id === item.medicineId);
      if (index !== -1) {
        updatedMedicines[index].quantity -= item.quantity;
      }
    });
    setMedicines(updatedMedicines);
    setSelectedSaleForReceipt(newSale);
    setShowReceiptModal(true);
  };

  // Delete a sale (restore stock)
  const deleteSale = (saleId) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;
    if (window.confirm('Delete this sale? Stock will be restored.')) {
      const updatedMedicines = [...medicines];
      saleToDelete.items.forEach(item => {
        const index = updatedMedicines.findIndex(m => m.id === item.medicineId);
        if (index !== -1) {
          updatedMedicines[index].quantity += item.quantity;
        }
      });
      setMedicines(updatedMedicines);
      setSales(sales.filter(s => s.id !== saleId));
    }
  };

  // Metrics
  const totalMedicines = medicines.length;
  const activeMedicines = medicines.filter(m => m.quantity > 0 && !isExpired(m.expiryDate)).length;
  const lowStockMedicines = medicines.filter(m => isLowStock(m.quantity) && !isExpired(m.expiryDate)).length;
  const expiredMedicines = medicines.filter(m => isExpired(m.expiryDate)).length;

  // Export CSV
  const exportToCSV = (data, filename) => {
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).join(',')).join('\n');
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportInventory = () => {
    const exportData = medicines.map(m => ({
      ID: m.id,
      'Medicine Name': m.medicineName,
      'Generic Name': m.genericName,
      Quantity: m.quantity,
      'Expiry Date': m.expiryDate,
      Price: m.price,
      Status: m.quantity === 0 ? 'Out of Stock' : (isExpired(m.expiryDate) ? 'Expired' : (isLowStock(m.quantity) ? 'Low Stock' : 'Active'))
    }));
    exportToCSV(exportData, 'inventory.csv');
  };

  const exportSales = () => {
    const exportData = sales.map(s => ({
      'Bill #': s.billNumber,
      Date: s.date,
      Customer: s.customerName,
      Items: s.items.map(i => `${i.medicineName} x${i.quantity}`).join('; '),
      'Total Amount': s.totalAmount,
      Payment: s.paymentMethod
    }));
    exportToCSV(exportData, 'sales.csv');
  };

  // Filter medicines
  const filteredMedicines = medicines.filter(m =>
    m.medicineName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.genericName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter sales
  const filteredSales = sales.filter(s =>
    s.billNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ---------- Render Functions ----------
  const renderInventory = () => (
    <>
      <div className="metrics">
        <div className="card"><h3>Total Medicines</h3><div className="value">{totalMedicines}</div></div>
        <div className="card"><h3>Active</h3><div className="value">{activeMedicines}</div></div>
        <div className="card"><h3>Low Stock</h3><div className="value">{lowStockMedicines}</div></div>
        <div className="card"><h3>Expired</h3><div className="value">{expiredMedicines}</div></div>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by medicine name, generic name, or ID..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button className="btn btn-primary" onClick={() => { setEditingMedicine(null); setShowAddMedicineModal(true); }}>+ Add Medicine</button>
        <button className="btn" onClick={exportInventory}>📥 Export CSV</button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Medicine Name</th><th>Generic Name</th><th>Quantity</th><th>Expiry Date</th><th>Status</th><th>Price</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMedicines.map(med => {
              const expired = isExpired(med.expiryDate);
              const lowStock = isLowStock(med.quantity) && !expired && med.quantity > 0;
              const statusClass = expired ? 'status-expired' : (lowStock ? 'status-lowstock' : 'status-active');
              const statusText = expired ? 'Expired' : (lowStock ? 'Low Stock' : (med.quantity === 0 ? 'Out of Stock' : 'Active'));

              return (
                <tr key={med.id}>
                  <td>{med.id}</td>
                  <td>{med.medicineName}</td>
                  <td>{med.genericName}</td>
                  <td>{med.quantity}</td>
                  <td>{med.expiryDate}</td>
                  <td><span className={`status-badge ${statusClass}`}>{statusText}</span></td>
                  <td>${med.price.toFixed(2)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => { setEditingMedicine(med); setShowAddMedicineModal(true); }}>✏️</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteMedicine(med.id)}>🗑️</button>
                    <button className="btn btn-success btn-sm" onClick={() => { setSelectedMedicineForSell(med); setShowSellModal(true); }}>🛒</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderSales = () => (
    <>
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by bill number or customer..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <button className="btn btn-primary" onClick={() => setShowCreateSaleModal(true)}>+ New Sale</button>
        <button className="btn" onClick={exportSales}>📥 Export CSV</button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Bill #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSales.map(sale => (
              <tr key={sale.id}>
                <td>{sale.billNumber}</td>
                <td>{sale.date}</td>
                <td>{sale.customerName}</td>
                <td>{sale.items.length} items</td>
                <td>${sale.totalAmount.toFixed(2)}</td>
                <td>{sale.paymentMethod}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => { setSelectedSaleForReceipt(sale); setShowReceiptModal(true); }}>🧾 Receipt</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSale(sale.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderReports = () => (
    <div>
      <h3>Export Data</h3>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button className="btn btn-primary" onClick={exportInventory}>Export Inventory CSV</button>
        <button className="btn btn-primary" onClick={exportSales}>Export Sales CSV</button>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      <div className="header">
        <h1>Pharmacy Mgmt <small>Olası Khaiqarha</small></h1>
        <div className="tab-buttons">
          <button className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>Inventory</button>
          <button className={activeTab === 'sales' ? 'active' : ''} onClick={() => setActiveTab('sales')}>Sales</button>
          <button className={activeTab === 'reports' ? 'active' : ''} onClick={() => setActiveTab('reports')}>Reports</button>
        </div>
      </div>

      <div className="content">
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'sales' && renderSales()}
        {activeTab === 'reports' && renderReports()}
      </div>

      {/* Modals */}
      {showAddMedicineModal && (
        <MedicineModal
          medicine={editingMedicine}
          onClose={() => { setShowAddMedicineModal(false); setEditingMedicine(null); }}
          onSave={(data) => {
            if (editingMedicine) {
              updateMedicine(editingMedicine.id, data);
            } else {
              addMedicine(data);
            }
            setShowAddMedicineModal(false);
            setEditingMedicine(null);
          }}
        />
      )}

      {showSellModal && selectedMedicineForSell && (
        <SellModal
          medicine={selectedMedicineForSell}
          onClose={() => setShowSellModal(false)}
          onSell={(quantity) => {
            sellMedicine(selectedMedicineForSell, quantity);
            setShowSellModal(false);
          }}
        />
      )}

      {showCreateSaleModal && (
        <CreateSaleModal
          medicines={medicines}
          onClose={() => setShowCreateSaleModal(false)}
          onCreateSale={createSale}
        />
      )}

      {showReceiptModal && selectedSaleForReceipt && (
        <ReceiptModal
          sale={selectedSaleForReceipt}
          onClose={() => { setShowReceiptModal(false); setSelectedSaleForReceipt(null); }}
        />
      )}
    </div>
  );
}

// ---------- Receipt Modal with PDF Download ----------
function ReceiptModal({ sale, onClose }) {
  const receiptRef = useRef();

  const downloadPDF = async () => {
    const element = receiptRef.current;
    if (!element) return;

    // Capture the element as canvas
    const canvas = await html2canvas(element, {
      scale: 2, // higher quality
      backgroundColor: '#ffffff'
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    const imgWidth = 190; // mm
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    pdf.save(`receipt_${sale.billNumber}.pdf`);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Receipt</h2>
        <div ref={receiptRef} className="receipt">
          <h3>Pharmacy Mgmt</h3>
          <p>Olası Khaiqarha</p>
          <hr />
          <p><strong>Bill #:</strong> {sale.billNumber}</p>
          <p><strong>Date:</strong> {sale.date}</p>
          <p><strong>Customer:</strong> {sale.customerName}</p>
          <hr />
          {sale.items.map((item, idx) => (
            <div key={idx} className="item">
              <span>{item.medicineName} x {item.quantity}</span>
              <span>${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <hr />
          <div className="item" style={{ fontWeight: 'bold' }}>
            <span>Total</span>
            <span>${sale.totalAmount.toFixed(2)}</span>
          </div>
          <p><strong>Payment:</strong> {sale.paymentMethod}</p>
          <hr />
          <p style={{ textAlign: 'center', fontSize: '0.8rem' }}>Thank you for your purchase!</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={downloadPDF}>Download PDF</button>
        </div>
      </div>
    </div>
  );
}

// Medicine Modal (unchanged from previous)
function MedicineModal({ medicine, onClose, onSave }) {
  const [form, setForm] = useState({
    medicineName: medicine?.medicineName || '',
    genericName: medicine?.genericName || '',
    quantity: medicine?.quantity || 0,
    expiryDate: medicine?.expiryDate || '',
    price: medicine?.price || 0,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.medicineName || !form.genericName || !form.expiryDate || form.price <= 0) {
      alert('Please fill all required fields correctly.');
      return;
    }
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{medicine ? 'Edit Medicine' : 'Add Medicine'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label>Medicine Name*</label><input value={form.medicineName} onChange={e => setForm({...form, medicineName: e.target.value})} required /></div>
          <div className="form-group"><label>Generic Name*</label><input value={form.genericName} onChange={e => setForm({...form, genericName: e.target.value})} required /></div>
          <div className="form-group"><label>Quantity</label><input type="number" min="0" value={form.quantity} onChange={e => setForm({...form, quantity: parseInt(e.target.value)})} /></div>
          <div className="form-group"><label>Expiry Date*</label><input type="date" value={form.expiryDate} onChange={e => setForm({...form, expiryDate: e.target.value})} required /></div>
          <div className="form-group"><label>Price ($)*</label><input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value)})} required /></div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Sell Modal (unchanged)
function SellModal({ medicine, onClose, onSell }) {
  const [quantity, setQuantity] = useState(1);
  const maxQty = medicine.quantity;
  const handleSell = () => {
    if (quantity <= 0 || quantity > maxQty) {
      alert(`Invalid quantity. Max available: ${maxQty}`);
      return;
    }
    onSell(quantity);
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Sell {medicine.medicineName}</h2>
        <p>Available stock: {maxQty}</p>
        <div className="form-group">
          <label>Quantity to sell</label>
          <input type="number" min="1" max={maxQty} value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} />
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSell}>Sell</button>
        </div>
      </div>
    </div>
  );
}

// Create Sale Modal (unchanged)
function CreateSaleModal({ medicines, onClose, onCreateSale }) {
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [cart, setCart] = useState([]);
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [quantity, setQuantity] = useState(1);

  const addToCart = () => {
    if (!selectedMedicineId) return;
    const medicine = medicines.find(m => m.id === selectedMedicineId);
    if (!medicine) return;
    const qty = parseInt(quantity);
    if (qty <= 0) return;
    if (qty > medicine.quantity) {
      alert(`Only ${medicine.quantity} in stock.`);
      return;
    }
    const existing = cart.find(item => item.medicineId === medicine.id);
    if (existing) {
      if (existing.quantity + qty > medicine.quantity) {
        alert(`Cannot add more than ${medicine.quantity} total.`);
        return;
      }
      setCart(cart.map(item => item.medicineId === medicine.id ? { ...item, quantity: item.quantity + qty } : item));
    } else {
      setCart([...cart, { medicineId: medicine.id, medicineName: medicine.medicineName, quantity: qty, price: medicine.price }]);
    }
    setSelectedMedicineId('');
    setQuantity(1);
  };

  const removeFromCart = (medicineId) => {
    setCart(cart.filter(item => item.medicineId !== medicineId));
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }
    if (cart.length === 0) {
      alert('Please add at least one medicine');
      return;
    }
    onCreateSale({
      customerName: customerName.trim(),
      items: cart.map(item => ({
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity
      })),
      totalAmount,
      paymentMethod
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Create New Sale</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label>Customer Name</label><input value={customerName} onChange={e => setCustomerName(e.target.value)} required /></div>
          <div className="form-group"><label>Payment Method</label><select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Cash</option><option>Card</option><option>Online</option></select></div>

          <div style={{ background: '#f8f9fa', padding: '1rem', borderRadius: '12px', margin: '1rem 0' }}>
            <h4>Add Medicines</h4>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <select value={selectedMedicineId} onChange={e => setSelectedMedicineId(e.target.value)} style={{ flex: 2, padding: '8px' }}>
                <option value="">Select Medicine</option>
                {medicines.filter(m => m.quantity > 0 && !isExpired(m.expiryDate)).map(m => (
                  <option key={m.id} value={m.id}>{m.medicineName} (${m.price} | Stock: {m.quantity})</option>
                ))}
              </select>
              <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: '80px' }} />
              <button type="button" className="btn btn-primary" onClick={addToCart}>Add</button>
            </div>
            <h5>Cart</h5>
            {cart.map(item => (
              <div key={item.medicineId} className="cart-item">
                <span><strong>{item.medicineName}</strong> x {item.quantity} @ ${item.price.toFixed(2)} = ${(item.price * item.quantity).toFixed(2)}</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeFromCart(item.medicineId)}>Remove</button>
              </div>
            ))}
            <div className="cart-total">Total: ${totalAmount.toFixed(2)}</div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Sale</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;