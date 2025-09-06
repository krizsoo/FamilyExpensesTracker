import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';

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
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ amount: '', category: '', date: '', description: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Firestore setup
  const db = getFirestore();
  const transactionsRef = collection(db, 'users', user.uid, 'transactions');

  // Listen for transactions
  useEffect(() => {
    const q = query(transactionsRef, orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
    // eslint-disable-next-line
  }, []);

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
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
    } catch (err) {
      setError('Failed to add transaction.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-md p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-blue-600">Family Finance Tracker</h1>
        <button onClick={onSignOut} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition">Sign Out</button>
      </header>
      <main className="p-8 max-w-2xl mx-auto">
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
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-t">
                    <td className="py-2">{tx.date}</td>
                    <td className="py-2">{tx.amount}</td>
                    <td className="py-2">{tx.category}</td>
                    <td className="py-2">{tx.description}</td>
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