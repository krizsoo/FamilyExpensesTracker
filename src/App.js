import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

// The following variables are provided by the Canvas environment.
// DO NOT MODIFY them.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The main application component.
const App = () => {
  // Hardcoded exchange rates for demonstration purposes.
  // The value is the rate to convert to the base currency (HUF).
  const EXCHANGE_RATES = {
    HUF: 1, // Base currency
    USD: 360,
    EUR: 395,
    GBP: 455,
  };
  const CURRENCIES = ['HUF', 'USD', 'EUR', 'GBP'];
  
  // State for the Firebase services
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // State for the app data
  const [transactions, setTransactions] = useState([]);
  const [formData, setFormData] = useState({
    date: '',
    type: 'Expense',
    category: 'Groceries',
    amount: '',
    currency: 'HUF',
    notes: '',
  });
  const [selectedMonth, setSelectedMonth] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('HUF'); // New state for selected display currency
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  // Firebase Initialization and Authentication
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestore);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // Sign in anonymously if no user is found
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (error) {
            console.error('Firebase authentication failed:', error);
          }
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase initialization failed:", error);
    }
  }, []);

  // Fetch data from Firestore
  useEffect(() => {
    // Only fetch data if auth is ready and we have a user ID
    if (isAuthReady && db && userId) {
      // Create a collection path for public data
      const publicDataPath = `/artifacts/${appId}/public/data/expenses`;
      
      const q = query(collection(db, publicDataPath));
      
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const docs = [];
        querySnapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() });
        });
        setTransactions(docs.sort((a, b) => new Date(b.date) - new Date(a.date)));
      });

      return () => unsubscribe();
    }
  }, [isAuthReady, db, userId]);

  // Set the default date to today and default month to the current month
  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    setFormData(prev => ({
      ...prev,
      date: `${year}-${month}-${String(today.getDate()).padStart(2, '0')}`,
    }));
    setSelectedMonth(`${year}-${month}`);
  }, []);

  // Function to show temporary messages
  const showMessage = (text, type = 'success') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3000);
  };
  
  // Handles changes to the form inputs
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  // Handles form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthReady || !db || !userId) {
      showMessage('Error: Not authenticated or Firestore not initialized.', 'error');
      console.error('Form submission failed: Firestore or auth not ready.');
      return;
    }
    
    // Convert the amount to HUF for storage and calculation
    const amountInHUF = parseFloat(formData.amount) * (EXCHANGE_RATES[formData.currency] || 1);

    const newTransaction = {
      ...formData,
      amount: parseFloat(formData.amount),
      amountInHUF: parseFloat(amountInHUF.toFixed(2)),
      timestamp: new Date().toISOString(),
      userId, // Store the userId with the transaction
    };
    
    setIsSaving(true);
    try {
      // Create a new document in the public 'expenses' collection
      const docRef = await addDoc(collection(db, `/artifacts/${appId}/public/data/expenses`), newTransaction);
      showMessage('Transaction added successfully!', 'success');
      // Reset form after successful submission
      setFormData({
        date: newTransaction.date,
        type: 'Expense',
        category: 'Groceries',
        amount: '',
        currency: 'HUF',
        notes: '',
      });
    } catch (e) {
      console.error('Error adding document: ', e);
      showMessage('Error adding transaction.', 'error');
    } finally {
      setIsSaving(false);
    }
  };
  
  // Function to delete a transaction
  const handleDelete = async (id) => {
    if (!isAuthReady || !db || !userId) {
      showMessage('Error: Not authenticated or Firestore not initialized.', 'error');
      return;
    }
    try {
      await deleteDoc(doc(db, `/artifacts/${appId}/public/data/expenses`, id));
      showMessage('Transaction deleted successfully!', 'success');
    } catch (e) {
      console.error('Error deleting document: ', e);
      showMessage('Error deleting transaction.', 'error');
    }
  };

  // Helper function to convert an amount from HUF to the display currency
  const convertFromHUF = (amountInHUF) => {
    const rate = EXCHANGE_RATES[displayCurrency] || 1;
    return amountInHUF / rate;
  };
  
  // Memoize monthly summary calculations for performance
  const monthlySummary = useMemo(() => {
    const summary = {};
    if (!transactions || transactions.length === 0) {
      return [];
    }
    transactions.forEach(transaction => {
      const transactionMonth = transaction.date.substring(0, 7);
      if (transactionMonth === selectedMonth) {
        if (!summary[transaction.category]) {
          summary[transaction.category] = { expense: 0, income: 0 };
        }
        if (transaction.type === 'Expense') {
          summary[transaction.category].expense += transaction.amountInHUF;
        } else {
          summary[transaction.category].income += transaction.amountInHUF;
        }
      }
    });

    // Transform summary object into an array for the chart
    // Convert the amounts from HUF to the selected display currency for the chart data
    const rate = EXCHANGE_RATES[displayCurrency] || 1;
    return Object.keys(summary).map(category => ({
      category,
      Expenses: parseFloat((summary[category].expense / rate).toFixed(2)),
      Income: parseFloat((summary[category].income / rate).toFixed(2)),
    }));
  }, [transactions, selectedMonth, displayCurrency]);
  
  // Get all unique years and months for the select dropdown
  const availableMonths = useMemo(() => {
    if (!transactions) {
      return [];
    }
    const months = new Set();
    transactions.forEach(transaction => {
      months.add(transaction.date.substring(0, 7));
    });
    return Array.from(months).sort().reverse();
  }, [transactions]);
  
  // Calculate the net balance in the selected display currency
  const netBalance = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return 0;
    }
    const totalInHUF = transactions.reduce((sum, transaction) => {
      if (transaction.date.substring(0, 7) === selectedMonth) {
        return sum + (transaction.type === 'Income' ? transaction.amountInHUF : -transaction.amountInHUF);
      }
      return sum;
    }, 0);
    return convertFromHUF(totalInHUF);
  }, [transactions, selectedMonth, displayCurrency]);
  
  // Calculate total expenses for the selected month in the display currency
  const totalExpenses = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return 0;
    }
    const totalHUF = transactions.reduce((sum, transaction) => {
      if (transaction.type === 'Expense' && transaction.date.substring(0, 7) === selectedMonth) {
        return sum + transaction.amountInHUF;
      }
      return sum;
    }, 0);
    return convertFromHUF(totalHUF);
  }, [transactions, selectedMonth, displayCurrency]);

  // Calculate total income for the selected month in the display currency
  const totalIncome = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return 0;
    }
    const totalHUF = transactions.reduce((sum, transaction) => {
      if (transaction.type === 'Income' && transaction.date.substring(0, 7) === selectedMonth) {
        return sum + transaction.amountInHUF;
      }
      return sum;
    }, 0);
    return convertFromHUF(totalHUF);
  }, [transactions, selectedMonth, displayCurrency]);

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans text-gray-800">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Section */}
        <div className="bg-white p-6 rounded-2xl shadow-lg mb-8">
          <h1 className="text-3xl font-bold text-center text-indigo-600 mb-2">Family Expense Tracker</h1>
          <p className="text-center text-gray-500">Track and visualize your income and expenses in one place.</p>
          {userId && (
            <p className="text-xs text-center text-gray-400 mt-2">
              User ID for sharing: <span className="font-mono text-gray-600">{userId}</span>
            </p>
          )}
        </div>
        
        {/* Message Box */}
        {message && (
          <div className={`p-4 rounded-xl text-white mb-4 shadow-md ${messageType === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
            {message}
          </div>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Form and Summary Column */}
          <div className="lg:col-span-1 space-y-8">
            
            {/* Input Form */}
            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h2 className="text-2xl font-semibold mb-4 text-indigo-600">Add New Transaction</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex flex-col">
                  <label htmlFor="date" className="text-sm font-medium text-gray-700">Date</label>
                  <input
                    type="date"
                    id="date"
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                    required
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div className="flex flex-col">
                  <label htmlFor="type" className="text-sm font-medium text-gray-700">Type</label>
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleInputChange}
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="Expense">Expense</option>
                    <option value="Income">Income</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="category" className="text-sm font-medium text-gray-700">Category</label>
                  <select
                    id="category"
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="Groceries">Groceries</option>
                    <option value="Rent">Rent</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Fun">Fun</option>
                    <option value="Salary">Salary</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex space-x-2">
                  <div className="flex-1 flex flex-col">
                    <label htmlFor="amount" className="text-sm font-medium text-gray-700">Amount</label>
                    <input
                      type="number"
                      id="amount"
                      name="amount"
                      value={formData.amount}
                      onChange={handleInputChange}
                      required
                      min="0.01"
                      step="0.01"
                      className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex-1 flex flex-col">
                    <label htmlFor="currency" className="text-sm font-medium text-gray-700">Currency</label>
                    <select
                      id="currency"
                      name="currency"
                      value={formData.currency}
                      onChange={handleInputChange}
                      className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col">
                  <label htmlFor="notes" className="text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    rows="2"
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  ></textarea>
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className={`w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${isSaving ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'}`}
                >
                  {isSaving ? 'Saving...' : 'Add Transaction'}
                </button>
              </form>
            </div>
            
            {/* Monthly Summary */}
            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h2 className="text-2xl font-semibold mb-4 text-indigo-600">Monthly Summary</h2>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <label htmlFor="month-selector" className="text-sm font-medium text-gray-700">Month:</label>
                  <select
                    id="month-selector"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {availableMonths.length > 0 ? (
                      availableMonths.map(month => (
                        <option key={month} value={month}>{month}</option>
                      ))
                    ) : (
                      <option value="">No data available</option>
                    )}
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <label htmlFor="display-currency" className="text-sm font-medium text-gray-700">View in:</label>
                  <select
                    id="display-currency"
                    value={displayCurrency}
                    onChange={(e) => setDisplayCurrency(e.target.value)}
                    className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                  <span className="font-medium text-gray-600">Total Income:</span>
                  <span className="font-bold text-green-600">{totalIncome.toFixed(2)} {displayCurrency}</span>
                </div>
                <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                  <span className="font-medium text-gray-600">Total Expenses:</span>
                  <span className="font-bold text-red-600">{totalExpenses.toFixed(2)} {displayCurrency}</span>
                </div>
                <div className="flex justify-between items-center bg-indigo-100 p-3 rounded-lg">
                  <span className="font-bold text-indigo-800">Net Balance:</span>
                  <span className={`font-bold ${netBalance >= 0 ? 'text-green-800' : 'text-red-800'}`}>{netBalance.toFixed(2)} {displayCurrency}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Chart and Transaction List Column */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Monthly Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h2 className="text-2xl font-semibold mb-4 text-indigo-600">Monthly Expense & Income Breakdown</h2>
              {monthlySummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={monthlySummary}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip formatter={(value) => `${value.toFixed(2)} ${displayCurrency}`} />
                    <Legend />
                    <Bar dataKey="Expenses" fill="#EF4444" />
                    <Bar dataKey="Income" fill="#22C55E" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-gray-500">No data for the selected month.</p>
              )}
            </div>
            
            {/* Transaction List */}
            <div className="bg-white p-6 rounded-2xl shadow-lg">
              <h2 className="text-2xl font-semibold mb-4 text-indigo-600">All Transactions</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount ({displayCurrency})</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{transaction.date}</td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${transaction.type === 'Income' ? 'text-green-600' : 'text-red-600'}`}>{transaction.type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{transaction.category}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{transaction.amount.toFixed(2)} {transaction.currency}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{convertFromHUF(transaction.amountInHUF).toFixed(2)} {displayCurrency}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate">{transaction.notes}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => handleDelete(transaction.id)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
