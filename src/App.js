import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, Timestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';

// --- Firebase Config ---
let firebaseConfig;
try {
  firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
} catch (e) {
  firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", projectId: "YOUR_PROJECT_ID" };
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
      setError("Firebase configuration is missing.");
      setIsLoading(false);
      return;
    }
    try {
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      setAuth(authInstance);
      const unsubscribe = onAuthStateChanged(authInstance, (user) => {
        setUser(user);
        setIsLoading(false);
      });
      return () => unsubscribe();
    } catch (e) {
      setError("Failed to initialize application.");
      setIsLoading(false);
    }
  }, []);

  const handleSignOut = () => {
    if (auth) signOut(auth).catch(() => {});
  };

  if (isLoading) return <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">Loading...</div>;
  if (error) return <div className="text-red-500 text-center p-8">{error}</div>;

  return user ? <Dashboard user={user} onSignOut={handleSignOut} /> : <AuthScreen auth={auth} />;
}

function AuthScreen({ auth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-blue-600 mb-6 text-center">{isLogin ? 'Login' : 'Sign Up'}</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button type="submit" className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition">{isLogin ? 'Login' : 'Sign Up'}</button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-6">
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <button onClick={() => setIsLogin(!isLogin)} className="font-medium text-blue-600 hover:text-blue-500 ml-1">
            {isLogin ? 'Sign Up' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
}

function Dashboard({ user, onSignOut }) {
  // Recurring items state
  const [recurring, setRecurring] = useState([]);
  const [recForm, setRecForm] = useState({ amount: '', category: '', description: '' });
  const [recLoading, setRecLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ amount: '', category: '', date: '', description: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', category: '', date: '', description: '' });
  const [toast, setToast] = useState('');

  // Firestore setup
  const db = getFirestore();
  const transactionsRef = collection(db, 'users', user.uid, 'transactions');

  // Recurring items collection
  const recurringRef = collection(db, 'users', user.uid, 'recurring');


  // Listen for transactions
  useEffect(() => {
    const q = query(transactionsRef, orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
    // eslint-disable-next-line
  }, []);

  // Listen for recurring items
  useEffect(() => {
    const unsub = onSnapshot(recurringRef, (snapshot) => {
      setRecurring(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
    // eslint-disable-next-line
  }, []);
  // Recurring item handlers
  const handleRecChange = (e) => {
    setRecForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };
  const handleRecAdd = async (e) => {
    e.preventDefault();
    setRecLoading(true);
    try {
      if (!recForm.amount || !recForm.category) {
        setToast('Amount and category required for recurring.');
        setRecLoading(false);
        return;
      }
      await addDoc(recurringRef, {
        amount: parseFloat(recForm.amount),
        category: recForm.category,
        description: recForm.description,
        createdAt: Timestamp.now(),
      });
      setRecForm({ amount: '', category: '', description: '' });
      setToast('Recurring item added!');
    } catch {
      setToast('Failed to add recurring item.');
    }
    setRecLoading(false);
  };
  const handleRecDelete = async (id) => {
    if (!window.confirm('Delete this recurring item?')) return;
    try {
      await deleteDoc(doc(recurringRef, id));
      setToast('Recurring item deleted!');
    } catch {
      setToast('Failed to delete recurring item.');
    }
  };
  // Post all recurring items for this month
  const handlePostRecurring = async () => {
    if (recurring.length === 0) return;
    setRecLoading(true);
    const today = new Date();
    const monthStr = today.toISOString().slice(0, 7);
    // Only add if not already present for this month (by description)
    const already = new Set(transactions.filter(t => t.date && t.date.startsWith(monthStr)).map(t => t.description));
    let added = 0;
    for (const item of recurring) {
      if (already.has(item.description)) continue;
      await addDoc(transactionsRef, {
        amount: item.amount,
        category: item.category,
        date: monthStr + '-01',
        description: item.description,
        createdAt: Timestamp.now(),
      });
      added++;
    }
    setToast(added ? `Posted ${added} recurring item(s) for this month!` : 'No new recurring items to post.');
    setRecLoading(false);
  };

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };
  const handleEditChange = (e) => {
    setEditForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!form.amount || !form.category || !form.date) {
        setError('Amount, category, and date are required.');
        setLoading(false);
        return;
      }
      await addDoc(transactionsRef, {
        amount: parseFloat(form.amount),
        category: form.category,
        date: form.date,
        description: form.description,
        createdAt: Timestamp.now(),
      });
      setForm({ amount: '', category: '', date: '', description: '' });
      setToast('Transaction added!');
    } catch (err) {
      setError('Failed to add transaction.');
    }
    setLoading(false);
  };

  const handleEdit = (tx) => {
    setEditId(tx.id);
    setEditForm({ amount: tx.amount, category: tx.category, date: tx.date, description: tx.description || '' });
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    if (!editId) return;
    try {
      await updateDoc(doc(transactionsRef, editId), {
        amount: parseFloat(editForm.amount),
        category: editForm.category,
        date: editForm.date,
        description: editForm.description,
      });
      setEditId(null);
      setToast('Transaction updated!');
    } catch {
      setToast('Failed to update transaction.');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      await deleteDoc(doc(transactionsRef, id));
      setToast('Transaction deleted!');
    } catch {
      setToast('Failed to delete transaction.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-md p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-blue-600">Family Finance Tracker</h1>
        <button onClick={onSignOut} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition">Sign Out</button>
      </header>
      <main className="p-8 max-w-2xl mx-auto">
        {toast && <div className="mb-4 p-2 bg-green-100 text-green-700 rounded">{toast}</div>}

        {/* Recurring Items Section */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center justify-between">Recurring Items
            <button onClick={handlePostRecurring} disabled={recLoading} className="ml-2 bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm">Post for this month</button>
          </h2>
          <form onSubmit={handleRecAdd} className="flex gap-2 mb-4">
            <input name="amount" type="number" step="0.01" placeholder="Amount" value={recForm.amount} onChange={handleRecChange} className="border rounded px-2 py-1 w-24" required />
            <input name="category" type="text" placeholder="Category" value={recForm.category} onChange={handleRecChange} className="border rounded px-2 py-1 w-32" required />
            <input name="description" type="text" placeholder="Description" value={recForm.description} onChange={handleRecChange} className="border rounded px-2 py-1 w-40" />
            <button type="submit" disabled={recLoading} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded">Add</button>
          </form>
          <ul>
            {recurring.length === 0 && <li className="text-gray-500">No recurring items.</li>}
            {recurring.map(item => (
              <li key={item.id} className="flex items-center justify-between border-b py-2">
                <span>{item.category} - {item.amount} {item.description && `- ${item.description}`}</span>
                <button onClick={() => handleRecDelete(item.id)} className="bg-red-500 text-white px-2 py-1 rounded text-xs">Delete</button>
              </li>
            ))}
          </ul>
        </div>

        {/* Transaction Section */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-xl font-bold mb-4">Add Transaction</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="flex gap-4">
              <input name="amount" type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={handleChange} className="flex-1 border rounded px-3 py-2" required />
              <input name="category" type="text" placeholder="Category" value={form.category} onChange={handleChange} className="flex-1 border rounded px-3 py-2" required />
            </div>
            <div className="flex gap-4">
              <input name="date" type="date" value={form.date} onChange={handleChange} className="flex-1 border rounded px-3 py-2" required />
              <input name="description" type="text" placeholder="Description" value={form.description} onChange={handleChange} className="flex-1 border rounded px-3 py-2" />
            </div>
            {error && <div className="text-red-500 text-sm">{error}</div>}
            <button type="submit" disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition">{loading ? 'Adding...' : 'Add Transaction'}</button>
          </form>
        </div>
        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-xl font-bold mb-4">Transactions</h2>
          {transactions.length === 0 ? (
            <p className="text-gray-500">No transactions yet.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="py-2">Date</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Description</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-t">
                    {editId === tx.id ? (
                      <>
                        <td className="py-2"><input name="date" type="date" value={editForm.date} onChange={handleEditChange} className="border rounded px-2 py-1 w-28" /></td>
                        <td className="py-2"><input name="amount" type="number" value={editForm.amount} onChange={handleEditChange} className="border rounded px-2 py-1 w-20" /></td>
                        <td className="py-2"><input name="category" type="text" value={editForm.category} onChange={handleEditChange} className="border rounded px-2 py-1 w-24" /></td>
                        <td className="py-2"><input name="description" type="text" value={editForm.description} onChange={handleEditChange} className="border rounded px-2 py-1 w-32" /></td>
                        <td className="py-2 flex gap-2">
                          <button onClick={handleEditSave} className="bg-green-500 text-white px-2 py-1 rounded">Save</button>
                          <button onClick={() => setEditId(null)} className="bg-gray-300 px-2 py-1 rounded">Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2">{tx.date}</td>
                        <td className="py-2">{tx.amount}</td>
                        <td className="py-2">{tx.category}</td>
                        <td className="py-2">{tx.description}</td>
                        <td className="py-2 flex gap-2">
                          <button onClick={() => handleEdit(tx)} className="bg-blue-500 text-white px-2 py-1 rounded">Edit</button>
                          <button onClick={() => handleDelete(tx.id)} className="bg-red-500 text-white px-2 py-1 rounded">Delete</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}