import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, updateDoc, Timestamp, orderBy } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// --- Firebase Configuration ---
// This will be loaded from environment variables on the deployment server.
let firebaseConfig;
try {
    firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
} catch (e) {
    console.error("Firebase config is missing or invalid. Please set REACT_APP_FIREBASE_CONFIG environment variable.");
    // Provide a fallback for local development if needed, but deployment will fail without the env var.
    firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", projectId: "YOUR_PROJECT_ID" };
}


// --- App ID ---
// A unique ID for your app's data. You can change this to whatever you like.
const appId = 'family-finance-tracker-v1';

// --- Exchange Rate API Key ---
const EXCHANGE_RATE_API_KEY = "3a46be8bcdb0d1403ff6da95";

// --- Category Lists ---
const EXPENSE_CATEGORIES = [
  "Groceries", "Utilities", "Rent/Mortgage", "Transportation", "Dining Out",
  "Entertainment", "Healthcare", "Shopping", "Travel", "Education", "Other"
];
const INCOME_CATEGORIES = ["Salary", "Bonus", "Gift", "Freelance", "Investment", "Other"];

// --- Chart Colors ---
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#da70d6', '#ffc0cb', '#3cb371', '#ffa500', '#6a5acd'];

// --- Currency Symbols ---
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', HUF: 'Ft' };

// --- Helper Components & Icons ---
const LoadingSpinner = () => (
    <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
    </div>
);

const Toast = ({ message, type, onClose }) => (
    <div className={`fixed top-5 right-5 p-4 rounded-lg shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
        <span>{message}</span>
        <button onClick={onClose} className="ml-4 font-bold">X</button>
    </div>
);

const ConfirmationModal = ({ message, onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div className="bg-white rounded-lg p-8 shadow-2xl w-11/12 md:w-1/3">
            <h3 className="text-lg font-bold mb-4">Confirm Action</h3>
            <p className="mb-6">{message}</p>
            <div className="flex justify-end space-x-4">
                <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition">Cancel</button>
                <button onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition">Delete</button>
            </div>
        </div>
    </div>
);

const TrashIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>);
const PencilIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg>);


// --- Main App Component ---
export default function App() {
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [transactions, setTransactions] = useState([]);
    const [displayCurrency, setDisplayCurrency] = useState('USD');
    const [latestRates, setLatestRates] = useState(null);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const [showConfirmModal, setShowConfirmModal] = useState({ show: false, id: null });
    const [editingTransaction, setEditingTransaction] = useState(null);
    
    useEffect(() => {
        if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
            setError("Firebase configuration is missing. You need to set it up for deployment.");
            setIsLoading(false);
            return;
        }
        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setDb(dbInstance);

            onAuthStateChanged(authInstance, user => {
                if (user) { setUserId(user.uid); } 
                else { signInAnonymously(authInstance).catch(e => console.error("Anon sign-in failed:", e)); }
                setIsAuthReady(true);
            });
        } catch (e) {
            console.error("Firebase init failed:", e);
            setError("Failed to initialize application.");
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        setIsLoading(true);
        const collectionPath = `artifacts/${appId}/users/${userId}/transactions`;
        const q = query(collection(db, collectionPath), orderBy("transactionDate", "desc"));

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const data = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                transactionDate: doc.data().transactionDate.toDate(),
            }));
            setTransactions(data);
            setIsLoading(false);
        }, (err) => {
            console.error("Firestore error:", err);
            setError("Could not fetch data.");
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [isAuthReady, db, userId]);

    useEffect(() => {
        const manageRateCache = async () => {
            const cacheKey = 'exchangeRatesCache';
            const cachedData = localStorage.getItem(cacheKey);
            const today = new Date().toISOString().split('T')[0];

            if (cachedData) {
                const { date, rates } = JSON.parse(cachedData);
                if (date === today) {
                    setLatestRates(rates);
                    return; 
                }
            }
            setIsLoading(true);
            try {
                const url = `https://v6.exchangerate-api.com/v6/${EXCHANGE_RATE_API_KEY}/latest/USD`;
                const response = await fetch(url);
                const data = await response.json();
                if (data.result === 'success') {
                    const newCache = { date: today, rates: data.conversion_rates };
                    localStorage.setItem(cacheKey, JSON.stringify(newCache));
                    setLatestRates(data.conversion_rates);
                } else { throw new Error(data['error-type'] || "API Error"); }
            } catch (e) {
                showToast(`Could not update daily rates: ${e.message}`, 'error');
                if(cachedData) setLatestRates(JSON.parse(cachedData).rates);
            } finally {
                setIsLoading(false);
            }
        };
        if(isAuthReady) manageRateCache();
    }, [isAuthReady]);
    
    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type }), 4000);
    };

    const addTransaction = useCallback(async (data) => {
        if (!db || !userId || !latestRates) {
            showToast("Data not ready, please try again.", "error");
            return;
        }
        setIsLoading(true);
        try {
            const { originalAmount, originalCurrency } = data;
            let rate = latestRates[originalCurrency] || 1;
            let amountInBase = originalAmount / rate; // Convert from any currency TO USD

            const collectionPath = `artifacts/${appId}/users/${userId}/transactions`;
            await addDoc(collection(db, collectionPath), {
                ...data,
                originalAmount: parseFloat(originalAmount),
                transactionDate: Timestamp.fromDate(new Date(data.transactionDate)),
                baseCurrency: 'USD',
                exchangeRateToBase: rate, // This is rate from USD to originalCurrency
                amountInBaseCurrency: parseFloat(amountInBase),
                createdAt: Timestamp.now(),
            });
            showToast(`${data.type} added successfully!`);
        } catch (e) {
            showToast(`Failed to add transaction: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [db, userId, latestRates]);

    const updateTransaction = useCallback(async (updatedData) => {
        if (!db || !userId || !editingTransaction || !latestRates) {
            showToast("Data not ready, please try again.", "error");
            return;
        }
        setIsLoading(true);

        try {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/transactions`, editingTransaction.id);
            
            const { originalAmount, originalCurrency } = updatedData;
            const rate = latestRates[originalCurrency] || 1;
            const amountInBase = originalAmount / rate;

            const payload = {
                ...updatedData,
                originalAmount: parseFloat(originalAmount),
                transactionDate: Timestamp.fromDate(new Date(updatedData.transactionDate)),
                baseCurrency: 'USD',
                exchangeRateToBase: rate,
                amountInBaseCurrency: parseFloat(amountInBase),
            };

            await updateDoc(docRef, payload);
            showToast("Transaction updated!");
            setEditingTransaction(null);
        } catch (e) {
            showToast(`Update failed: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [db, userId, editingTransaction, latestRates]);
    
    const requestDeleteTransaction = (id) => setShowConfirmModal({ show: true, id });
    const handleConfirmDelete = async () => {
        const idToDelete = showConfirmModal.id;
        if (!db || !userId || !idToDelete) return;
        setIsLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions`, idToDelete));
            showToast("Transaction deleted.");
        } catch (e) {
            showToast(`Failed to delete: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
            setShowConfirmModal({ show: false, id: null });
        }
    };

    const summaryData = useMemo(() => {
        if (!latestRates) return { totalExpense: 0, totalIncome: 0, netBalance: 0, expenseChartData: [] };
        const conversionRate = latestRates[displayCurrency] || 1;
        const expenses = transactions.filter(t => t.type === 'Expense');
        const income = transactions.filter(t => t.type === 'Income');
        const totalExpense = expenses.reduce((acc, t) => acc + t.amountInBaseCurrency, 0) * conversionRate;
        const totalIncome = income.reduce((acc, t) => acc + t.amountInBaseCurrency, 0) * conversionRate;
        const expenseByCategory = expenses.reduce((acc, t) => {
            acc[t.category] = (acc[t.category] || 0) + (t.amountInBaseCurrency * conversionRate);
            return acc;
        }, {});
        const expenseChartData = Object.entries(expenseByCategory).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
        return { totalExpense, totalIncome, netBalance: totalIncome - totalExpense, expenseChartData };
    }, [transactions, displayCurrency, latestRates]);
    
    if (error) return <div className="text-red-500 text-center p-8">{error}</div>;

    return (
        <div className="bg-gray-100 min-h-screen font-sans text-gray-800">
            {isLoading && <div className="fixed inset-0 bg-white bg-opacity-70 z-40"><LoadingSpinner /></div>}
            {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast(t => ({...t, show: false}))} />}
            {showConfirmModal.show && <ConfirmationModal message="Are you sure you want to permanently delete this transaction?" onConfirm={handleConfirmDelete} onCancel={() => setShowConfirmModal({ show: false, id: null })} />}
            {editingTransaction && <EditModal transaction={editingTransaction} onSave={updateTransaction} onCancel={() => setEditingTransaction(null)} />}
            
            <header className="bg-white shadow-md">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <h1 className="text-3xl font-bold text-blue-600">Family Finance Tracker</h1>
                    {userId && <p className="text-sm text-gray-500 mt-1">Family ID: <strong className="select-all">{userId}</strong></p>}
                </div>
            </header>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 space-y-8">
                        <TransactionForm onSubmit={addTransaction} />
                        <SummaryReport summary={summaryData} currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
                    </div>
                    <div className="lg:col-span-2 space-y-8">
                        <CategoryChart data={summaryData.expenseChartData} currency={displayCurrency}/>
                        <TransactionList transactions={transactions} onDelete={requestDeleteTransaction} onEdit={setEditingTransaction} displayCurrency={displayCurrency} latestRates={latestRates}/>
                    </div>
                </div>
            </main>
        </div>
    );
}

// --- Child Components ---

function TransactionForm({ onSubmit }) {
    const [type, setType] = useState('Expense');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [formError, setFormError] = useState('');

    useEffect(() => {
        setCategory(type === 'Expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
    }, [type]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!amount || !date) { setFormError('Please fill out amount and date.'); return; }
        setFormError('');
        onSubmit({ type, originalAmount: parseFloat(amount), originalCurrency: currency, category, transactionDate: date, description });
        setAmount('');
        setDescription('');
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">New Transaction</h2>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-200 p-1 mb-4">
                <button onClick={() => setType('Expense')} className={`py-2 rounded-md font-semibold ${type === 'Expense' ? 'bg-red-500 text-white shadow' : 'text-gray-600'}`}>Expense</button>
                <button onClick={() => setType('Income')} className={`py-2 rounded-md font-semibold ${type === 'Income' ? 'bg-green-500 text-white shadow' : 'text-gray-600'}`}>Income</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="amount" className="block text-sm font-medium text-gray-700">Amount</label>
                        <input type="number" id="amount" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div>
                        <label htmlFor="currency" className="block text-sm font-medium text-gray-700">Currency</label>
                        <select id="currency" value={currency} onChange={e => setCurrency(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                            <option>USD</option> <option>EUR</option> <option>GBP</option> <option>HUF</option>
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                        <select id="category" value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                            {(type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => <option key={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="date" className="block text-sm font-medium text-gray-700">Date</label>
                        <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                    </div>
                </div>
                <div>
                    <label htmlFor="description" className="block text-sm font-medium text-gray-700">Comments</label>
                    <input type="text" id="description" value={description} onChange={e => setDescription(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                </div>
                {formError && <p className="text-red-500 text-sm">{formError}</p>}
                <button type="submit" className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition duration-300">Add Transaction</button>
            </form>
        </div>
    );
}

function EditModal({ transaction, onSave, onCancel }) {
    const [formData, setFormData] = useState({
        ...transaction,
        transactionDate: transaction.transactionDate.toISOString().split('T')[0]
    });

    useEffect(() => {
        const categories = formData.type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        if (!categories.includes(formData.category)) {
            setFormData(prev => ({ ...prev, category: categories[0] }));
        }
    }, [formData.type, formData.category]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleTypeChange = (newType) => {
        setFormData(prev => ({ ...prev, type: newType }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-8 shadow-2xl w-11/12 md:w-1/3">
                <h2 className="text-2xl font-bold mb-4">Edit Transaction</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-200 p-1 mb-4">
                        <button type="button" onClick={() => handleTypeChange('Expense')} className={`py-2 rounded-md font-semibold ${formData.type === 'Expense' ? 'bg-red-500 text-white shadow' : 'text-gray-600'}`}>Expense</button>
                        <button type="button" onClick={() => handleTypeChange('Income')} className={`py-2 rounded-md font-semibold ${formData.type === 'Income' ? 'bg-green-500 text-white shadow' : 'text-gray-600'}`}>Income</button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Amount</label>
                            <input type="number" name="originalAmount" value={formData.originalAmount} onChange={handleChange} step="0.01" required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Currency</label>
                            <select name="originalCurrency" value={formData.originalCurrency} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                                <option>USD</option> <option>EUR</option> <option>GBP</option> <option>HUF</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Category</label>
                            <select name="category" value={formData.category} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                                {(formData.type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => <option key={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Date</label>
                            <input type="date" name="transactionDate" value={formData.transactionDate} onChange={handleChange} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Comments</label>
                        <input type="text" name="description" value={formData.description} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div className="flex justify-end space-x-4 pt-4">
                        <button type="button" onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    );
}


function SummaryReport({ summary, currency, onCurrencyChange }) {
    const formatCurrency = (value) => `${CURRENCY_SYMBOLS[currency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Summary</h2>
                <select value={currency} onChange={e => onCurrencyChange(e.target.value)} className="px-3 py-1 border-gray-300 rounded-md shadow-sm">
                    <option>USD</option> <option>EUR</option> <option>GBP</option> <option>HUF</option>
                </select>
            </div>
            <div className="space-y-3">
                <div className="flex justify-between items-center"><span className="font-medium text-green-600">Total Income:</span><span className="font-semibold text-green-600">{formatCurrency(summary.totalIncome)}</span></div>
                <div className="flex justify-between items-center"><span className="font-medium text-red-600">Total Expenses:</span><span className="font-semibold text-red-600">{formatCurrency(summary.totalExpense)}</span></div>
                <hr/>
                <div className="flex justify-between items-center text-lg"><span className="font-bold">Net Balance:</span><span className={`font-bold ${summary.netBalance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{formatCurrency(summary.netBalance)}</span></div>
            </div>
        </div>
    );
}

function CategoryChart({ data, currency }) {
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Expense Breakdown</h2>
            <div style={{ width: '100%', height: 300 }}>
                {data.length > 0 ? (
                    <ResponsiveContainer>
                        <PieChart>
                            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} fill="#8884d8">
                                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(value) => `${CURRENCY_SYMBOLS[currency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                ) : <p className="text-center text-gray-500 pt-16">No expense data to display.</p>}
            </div>
        </div>
    );
}

function TransactionList({ transactions, onDelete, onEdit, displayCurrency, latestRates }) {
    const conversionRate = latestRates ? latestRates[displayCurrency] || 1 : 1;
    const formatCurrency = (value) => `${CURRENCY_SYMBOLS[displayCurrency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Transaction History</h2>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th scope="col" className="px-4 py-3">Date</th>
                            <th scope="col" className="px-4 py-3">Description</th>
                            <th scope="col" className="px-4 py-3">Category</th>
                            <th scope="col" className="px-4 py-3 text-right">Amount ({displayCurrency})</th>
                            <th scope="col" className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map(t => {
                            const isExpense = t.type === 'Expense';
                            const displayAmount = t.amountInBaseCurrency * conversionRate;
                            return (
                                <tr key={t.id} className="bg-white border-b hover:bg-gray-50">
                                    <td className="px-4 py-3">{t.transactionDate.toLocaleDateString()}</td>
                                    <td className="px-4 py-3 font-medium text-gray-900">{t.description || '-'}</td>
                                    <td className="px-4 py-3">{t.category}</td>
                                    <td className={`px-4 py-3 text-right font-semibold font-mono ${isExpense ? 'text-red-500' : 'text-green-500'}`}>
                                        {isExpense ? '-' : '+'}{formatCurrency(displayAmount)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end space-x-3">
                                            <button onClick={() => onEdit(t)} className="text-gray-400 hover:text-blue-600"><PencilIcon/></button>
                                            <button onClick={() => onDelete(t.id)} className="text-gray-400 hover:text-red-600"><TrashIcon/></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {transactions.length === 0 && <p className="text-center text-gray-500 py-8">No transactions recorded yet.</p>}
            </div>
        </div>
    );
}
