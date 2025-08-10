import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, updateDoc, Timestamp, orderBy, limit, startAfter, getDocs, endBefore, limitToLast, writeBatch, where } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';

// --- Firebase Configuration ---
let firebaseConfig;
try {
    firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
} catch (e) {
    console.error("Firebase config is missing or invalid. Please set REACT_APP_FIREBASE_CONFIG environment variable.");
    firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", projectId: "YOUR_PROJECT_ID" };
}

// --- App & Family ID ---
const appId = 'family-finance-tracker-v1';
const familyId = 'shared-family-data'; // All users will write to this single data store.
const TRANSACTIONS_PER_PAGE = 25;

// --- Exchange Rate API Key ---
const EXCHANGE_RATE_API_KEY = "3a46be8bcdb0d1403ff6da95";

// --- Category Lists ---
const INCOME_CATEGORIES = ["Salary", "Extra income"];
const EXPENSE_CATEGORIES = ["Accommodation", "Beauty", "Bills", "Business", "Car", "Charity", "Clothing", "Education", "Entertainment", "Food and drinks", "Gifts", "Groceries", "Healthcare", "Hobbies", "Home", "Kids", "Other", "Savings", "Shopping", "Sport and Hobbies", "Transport", "Travel", "Utilities", "Work"];
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#da70d6', '#ffc0cb', '#3cb371', '#ffa500', '#6a5acd', '#FF5733', '#C70039', '#900C3F', '#581845'];
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', HUF: 'Ft' };

// --- Helper Components & Icons ---
const LoadingSpinner = () => (<div className="flex justify-center items-center h-full"><div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div></div>);
const Toast = ({ message, type, onClose }) => (<div className={`fixed top-5 right-5 p-4 rounded-lg shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}><span>{message}</span><button onClick={onClose} className="ml-4 font-bold">X</button></div>);
const ConfirmationModal = ({ message, onConfirm, onCancel }) => (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><div className="bg-white rounded-lg p-8 shadow-2xl w-11/12 md:w-1/3"><h3 className="text-lg font-bold mb-4">Confirm Action</h3><p className="mb-6">{message}</p><div className="flex justify-end space-x-4"><button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition">Cancel</button><button onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition">Delete</button></div></div></div>);
const TrashIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>);
const PencilIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg>);

// --- Main App Component ---
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
            console.error("Firebase init failed:", e);
            setError("Failed to initialize application.");
            setIsLoading(false);
        }
    }, []);

    const handleSignOut = () => {
        if (auth) {
            signOut(auth).catch(e => console.error("Sign out failed:", e));
        }
    };

    if (isLoading) return <div className="fixed inset-0 bg-white z-50"><LoadingSpinner /></div>;
    if (error) return <div className="text-red-500 text-center p-8">{error}</div>;

    return (
        <>
            {user ? (
                <FinanceTracker user={user} onSignOut={handleSignOut} />
            ) : (
                <AuthScreen auth={auth} />
            )}
        </>
    );
}

// --- Authentication Screen Component ---
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


// --- Main Application Logic Component ---
function FinanceTracker({ user, onSignOut }) {
    const [db, setDb] = useState(null);
    const [page, setPage] = useState('dashboard');
    const [allTransactions, setAllTransactions] = useState([]);
    const [recurringExpenses, setRecurringExpenses] = useState([]);
    const [displayCurrency, setDisplayCurrency] = useState('USD');
    const [selectedMonths, setSelectedMonths] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [latestRates, setLatestRates] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const [showConfirmModal, setShowConfirmModal] = useState({ show: false, id: null, type: '' });
    const [editingTransaction, setEditingTransaction] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [initialMonthSet, setInitialMonthSet] = useState(false);

    useEffect(() => {
        setDb(getFirestore(initializeApp(firebaseConfig)));
    }, []);

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type }), 4000);
    };

    // Listeners for all transactions and recurring expenses
    useEffect(() => {
        if (db) {
            setIsLoading(true);
            const summaryQuery = query(collection(db, `artifacts/${appId}/families/${familyId}/transactions`), orderBy("transactionDate", "desc"));
            const unsubscribeSummary = onSnapshot(summaryQuery, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), transactionDate: doc.data().transactionDate.toDate() }));
                setAllTransactions(data);
                setIsLoading(false);
            });

            const recurringQuery = query(collection(db, `artifacts/${appId}/families/${familyId}/recurring`), orderBy("createdAt", "desc"));
            const unsubscribeRecurring = onSnapshot(recurringQuery, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRecurringExpenses(data);
            });

            return () => {
                unsubscribeSummary();
                unsubscribeRecurring();
            };
        }
    }, [db]);

    useEffect(() => {
        const manageRateCache = async () => {
            const cacheKey = 'exchangeRatesCache';
            const cachedData = localStorage.getItem(cacheKey);
            const today = new Date().toISOString().split('T')[0];
            if (cachedData) {
                const { date, rates } = JSON.parse(cachedData);
                if (date === today) { setLatestRates(rates); return; }
            }
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
                if (cachedData) setLatestRates(JSON.parse(cachedData).rates);
            }
        };
        manageRateCache();
    }, []);

    const availableMonths = useMemo(() => {
        const months = new Set(allTransactions.map(t => t.transactionDate.toISOString().slice(0, 7)));
        return Array.from(months).sort().reverse();
    }, [allTransactions]);

    useEffect(() => {
        if (availableMonths.length > 0 && !initialMonthSet) {
            setSelectedMonths([availableMonths[0]]);
            setInitialMonthSet(true);
        }
    }, [availableMonths, initialMonthSet]);

    const getYearMonthLocal = (date) => {
        const year = date.getFullYear();
        const month = ('0' + (date.getMonth() + 1)).slice(-2);
        return `${year}-${month}`;
    };

    const filteredTransactions = useMemo(() => {
        let transactions = allTransactions;

        if (selectedMonths.length > 0) {
            transactions = transactions.filter(t => selectedMonths.includes(getYearMonthLocal(t.transactionDate)));
        }

        if (selectedCategories.length > 0) {
            transactions = transactions.filter(t => selectedCategories.includes(t.category));
        }

        return transactions;
    }, [allTransactions, selectedMonths, selectedCategories]);
    
    const paginatedTransactions = useMemo(() => {
        const startIndex = (currentPage - 1) * TRANSACTIONS_PER_PAGE;
        const endIndex = startIndex + TRANSACTIONS_PER_PAGE;
        return filteredTransactions.slice(startIndex, endIndex);
    }, [filteredTransactions, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [selectedMonths, selectedCategories]);

    const totalPages = Math.ceil(filteredTransactions.length / TRANSACTIONS_PER_PAGE);

    const addTransaction = useCallback(async (data) => {
        if (!db || !latestRates) { showToast("Data not ready, please try again.", "error"); return; }
        setIsLoading(true);
        try {
            const { originalAmount, originalCurrency } = data;
            const rate = latestRates[originalCurrency] || 1;
            const amountInBase = originalAmount / rate;
            const collectionPath = `artifacts/${appId}/families/${familyId}/transactions`;
            await addDoc(collection(db, collectionPath), { ...data, originalAmount: parseFloat(originalAmount), transactionDate: Timestamp.fromDate(new Date(data.transactionDate)), baseCurrency: 'USD', exchangeRateToBase: rate, amountInBaseCurrency: parseFloat(amountInBase), createdAt: Timestamp.now() });
            showToast(`${data.type} added successfully!`);
        } catch (e) { showToast(`Failed to add transaction: ${e.message}`, 'error'); } finally { setIsLoading(false); }
    }, [db, latestRates]);

    const updateTransaction = useCallback(async (updatedData) => {
        if (!db || !editingTransaction || !latestRates) { showToast("Data not ready, please try again.", "error"); return; }
        setIsLoading(true);
        try {
            const docRef = doc(db, `artifacts/${appId}/families/${familyId}/transactions`, editingTransaction.id);
            const { originalAmount, originalCurrency } = updatedData;
            const rate = latestRates[originalCurrency] || 1;
            const amountInBase = originalAmount / rate;
            const payload = { ...updatedData, originalAmount: parseFloat(originalAmount), transactionDate: Timestamp.fromDate(new Date(updatedData.transactionDate)), baseCurrency: 'USD', exchangeRateToBase: rate, amountInBaseCurrency: parseFloat(amountInBase) };
            await updateDoc(docRef, payload);
            showToast("Transaction updated!");
            setEditingTransaction(null);
        } catch (e) { showToast(`Update failed: ${e.message}`, 'error'); } finally { setIsLoading(false); }
    }, [db, editingTransaction, latestRates]);

    const requestDelete = (id, type) => setShowConfirmModal({ show: true, id, type });
    
    const handleConfirmDelete = async () => {
        const { id: idToDelete, type } = showConfirmModal;
        if (!db || !idToDelete) return;
        
        const collectionName = type === 'transaction' ? 'transactions' : 'recurring';
        
        setIsLoading(true);
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/families/${familyId}/${collectionName}`, idToDelete));
            showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`);
        } catch (e) { showToast(`Failed to delete: ${e.message}`, 'error'); } 
        finally { 
            setIsLoading(false); 
            setShowConfirmModal({ show: false, id: null, type: '' });
        }
    };

    const addRecurringExpense = useCallback(async (data) => {
        if (!db) { showToast("Database not ready", "error"); return; }
        setIsLoading(true);
        try {
            const collectionPath = `artifacts/${appId}/families/${familyId}/recurring`;
            await addDoc(collection(db, collectionPath), { ...data, originalAmount: parseFloat(data.originalAmount), type: 'Expense', createdAt: Timestamp.now() });
            showToast('Recurring expense added!');
        } catch(e) { showToast(`Failed to add: ${e.message}`, 'error'); }
        finally { setIsLoading(false); }
    }, [db]);

    const reportData = useMemo(() => {
        if (!latestRates) return { totalExpense: 0, totalIncome: 0, netBalance: 0, expenseChartData: [], lineChartData: [] };
        
        const conversionRate = latestRates[displayCurrency] || 1;
        const expenses = filteredTransactions.filter(t => t.type === 'Expense');
        const income = filteredTransactions.filter(t => t.type === 'Income');
        const totalExpense = expenses.reduce((acc, t) => acc + t.amountInBaseCurrency, 0) * conversionRate;
        const totalIncome = income.reduce((acc, t) => acc + t.amountInBaseCurrency, 0) * conversionRate;
        const expenseByCategory = expenses.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + (t.amountInBaseCurrency * conversionRate); return acc; }, {});
        const expenseChartData = Object.entries(expenseByCategory).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        
        const monthlyData = filteredTransactions.reduce((acc, t) => {
            const month = getYearMonthLocal(t.transactionDate); // YYYY-MM
            if (!acc[month]) {
                acc[month] = { month, expense: 0, income: 0 };
            }
            if (t.type === 'Expense') {
                acc[month].expense += t.amountInBaseCurrency * conversionRate;
            } else {
                acc[month].income += t.amountInBaseCurrency * conversionRate;
            }
            return acc;
        }, {});

        const lineChartData = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));

        return { totalExpense, totalIncome, netBalance: totalIncome - totalExpense, expenseChartData, lineChartData };
    }, [filteredTransactions, displayCurrency, latestRates]);

    return (
        <div className="bg-gray-100 min-h-screen font-sans text-gray-800">
            {isLoading && <div className="fixed inset-0 bg-white bg-opacity-70 z-40"><LoadingSpinner /></div>}
            {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast(t => ({ ...t, show: false }))} />}
            {showConfirmModal.show && <ConfirmationModal message={`Are you sure you want to permanently delete this ${showConfirmModal.type}?`} onConfirm={handleConfirmDelete} onCancel={() => setShowConfirmModal({ show: false, id: null, type: '' })} />}
            {editingTransaction && <EditModal transaction={editingTransaction} onSave={updateTransaction} onCancel={() => setEditingTransaction(null)} />}
            
            <header className="bg-white shadow-md">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                         <h1 className="text-3xl font-bold text-blue-600">Family Finance</h1>
                         <nav className="flex space-x-2 rounded-lg bg-gray-200 p-1">
                            <button onClick={() => setPage('dashboard')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'dashboard' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Dashboard</button>
                            <button onClick={() => setPage('recurring')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'recurring' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Recurring</button>
                            <button onClick={() => setPage('import')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'import' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Import</button>
                         </nav>
                    </div>
                    <button onClick={onSignOut} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition">Sign Out</button>
                </div>
            </header>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {page === 'dashboard' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 space-y-8">
                            <TransactionForm onSubmit={addTransaction} allTransactions={allTransactions} />
                            <SummaryReport summary={reportData} currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <MonthFilter availableMonths={availableMonths} selectedMonths={selectedMonths} onSelectionChange={setSelectedMonths} />
                            <CategoryFilter selectedCategories={selectedCategories} onSelectionChange={setSelectedCategories} />
                            <CategoryChart data={reportData.expenseChartData} currency={displayCurrency} />
                            <LineChartComponent data={reportData.lineChartData} currency={displayCurrency} />
                            <TransactionList transactions={paginatedTransactions} onDelete={(id) => requestDelete(id, 'transaction')} onEdit={setEditingTransaction} displayCurrency={displayCurrency} latestRates={latestRates} onNextPage={() => setCurrentPage(p => Math.min(p + 1, totalPages))} onPrevPage={() => setCurrentPage(p => Math.max(p - 1, 1))} currentPage={currentPage} totalPages={totalPages} />
                        </div>
                    </div>
                )}
                {page === 'recurring' && (
                    <RecurringPage expenses={recurringExpenses} onAdd={addRecurringExpense} onDelete={(id) => requestDelete(id, 'recurring')} />
                )}
                {page === 'import' && (
                    <ImportPage db={db} showToast={showToast} />
                )}
            </main>
        </div>
    );
}

// --- Child Components ---

function MonthFilter({ availableMonths, selectedMonths, onSelectionChange }) {
    const handleMonthChange = (e) => {
        const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
        if (selectedOptions.includes("All")) {
            onSelectionChange([]);
        } else {
            onSelectionChange(selectedOptions);
        }
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="text-lg font-bold mb-2">Filter by Month</h3>
            <p className="text-sm text-gray-500 mb-3">Hold Ctrl (or Cmd on Mac) to select multiple months.</p>
            <select
                multiple
                value={selectedMonths}
                onChange={handleMonthChange}
                className="w-full p-2 border border-gray-300 rounded-md"
                size="6" 
            >
                <option value="All">All Months</option>
                {availableMonths.map(month => (
                    <option key={month} value={month}>
                        {new Date(month + '-02T00:00:00Z').toLocaleString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                    </option>
                ))}
            </select>
        </div>
    );
}


function CategoryFilter({ selectedCategories, onSelectionChange }) {
    const handleCategoryClick = (category) => {
        if (category === 'All') {
            onSelectionChange([]);
            return;
        }
        const newSelection = selectedCategories.includes(category)
            ? selectedCategories.filter(c => c !== category)
            : [...selectedCategories, category];
        onSelectionChange(newSelection);
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-3">
                 <h3 className="text-lg font-bold">Filter by Category</h3>
                 <button
                    onClick={() => handleCategoryClick('All')}
                    className={`px-3 py-1 text-sm rounded-full transition ${selectedCategories.length === 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                    All
                </button>
            </div>
            <div>
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Expenses</h4>
                <div className="flex flex-wrap gap-2">
                    {EXPENSE_CATEGORIES.map(category => (
                        <button
                            key={category}
                            onClick={() => handleCategoryClick(category)}
                            className={`px-3 py-1 text-sm rounded-full transition ${selectedCategories.includes(category) ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-4">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Income</h4>
                <div className="flex flex-wrap gap-2">
                    {INCOME_CATEGORIES.map(category => (
                        <button
                            key={category}
                            onClick={() => handleCategoryClick(category)}
                            className={`px-3 py-1 text-sm rounded-full transition ${selectedCategories.includes(category) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ImportPage({ db, showToast }) {
    const [file, setFile] = useState(null);
    const [isImporting, setIsImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [isWiping, setIsWiping] = useState(false);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleWipeData = async () => {
        if (!db) {
            showToast("Database not ready.", "error");
            return;
        }
        if (!window.confirm("ARE YOU SURE? This will permanently delete all transactions and cannot be undone.")) {
            return;
        }

        setIsWiping(true);
        try {
            const collectionPath = `artifacts/${appId}/families/${familyId}/transactions`;
            const collectionRef = collection(db, collectionPath);
            let deletedCount = 0;

            while (true) {
                const q = query(collectionRef, limit(500));
                const querySnapshot = await getDocs(q);

                if (querySnapshot.size === 0) {
                    break; 
                }

                const batch = writeBatch(db);
                querySnapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();

                deletedCount += querySnapshot.size;
                showToast(`Deleted ${deletedCount} transactions...`, "success");
            }
            showToast("All transactions have been wiped.", "success");
        } catch (e) {
            console.error("Error wiping data:", e);
            showToast(`Error wiping data: ${e.message}`, "error");
        } finally {
            setIsWiping(false);
        }
    };

    const handleImport = async () => {
        if (!file) {
            showToast("Please select a CSV file first.", "error");
            return;
        }
        if (!db) {
            showToast("Database not ready.", "error");
            return;
        }

        setIsImporting(true);
        setProgress(0);

        const reader = new FileReader();
        reader.onload = async (event) => {
            const csvData = event.target.result;
            // Basic CSV parsing
            const rows = csvData.split('\n').slice(1); // Skip header row
            const totalRecords = rows.length;
            let importedCount = 0;

            const approxRateHufToUsd = 0.0027; // Using an approximate rate

            // Use Firestore batch writes for efficiency
            let batch = writeBatch(db);
            const collectionRef = collection(db, `artifacts/${appId}/families/${familyId}/transactions`);

            for (let i = 0; i < totalRecords; i++) {
                const row = rows[i].split(',');
                const [transactionDate, originalAmount, category, description] = row;

                if (!transactionDate || !originalAmount) continue;

                const date = new Date(transactionDate);
                const amount = parseFloat(originalAmount);

                if (isNaN(date.getTime()) || isNaN(amount)) {
                    console.warn('Skipping invalid row:', row);
                    continue;
                }
                
                const trimmedCategory = category ? category.trim() : 'Other';
                const isIncome = INCOME_CATEGORIES.includes(trimmedCategory);

                const newTransaction = {
                    type: isIncome ? 'Income' : 'Expense',
                    originalAmount: amount,
                    originalCurrency: 'HUF',
                    category: trimmedCategory,
                    transactionDate: Timestamp.fromDate(date),
                    description: description || '',
                    baseCurrency: 'USD',
                    exchangeRateToBase: 1 / approxRateHufToUsd,
                    amountInBaseCurrency: amount * approxRateHufToUsd,
                    createdAt: Timestamp.now()
                };
                
                const docRef = doc(collectionRef); // Create a new doc with a random ID
                batch.set(docRef, newTransaction);
                
                importedCount++;
                setProgress(Math.round((i + 1) / totalRecords * 100));

                // Commit the batch every 500 writes
                if ((i + 1) % 500 === 0) {
                    await batch.commit();
                    batch = writeBatch(db); // start a new batch
                }
            }

            if (importedCount > 0 && importedCount % 500 !== 0) {
                await batch.commit(); // Commit the final batch
            }
            
            showToast(`Successfully imported ${importedCount} of ${totalRecords} records.`, "success");
            setIsImporting(false);
        };
        reader.readAsText(file);
    };

    return (
        <div className="bg-white p-8 rounded-lg shadow-md max-w-2xl mx-auto space-y-8">
            <div>
                <h2 className="text-2xl font-bold mb-4">Import Historical Data</h2>
                <p className="text-gray-600 mb-6">Upload your CSV file with columns: `transactionDate`, `originalAmount`, `category`, `description`. All amounts will be imported as HUF expenses.</p>
                
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">CSV File</label>
                    <input type="file" accept=".csv" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                </div>

                <button onClick={handleImport} disabled={isImporting || !file} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {isImporting ? `Importing... ${progress}%` : 'Start Import'}
                </button>

                {isImporting && (
                    <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                )}
            </div>
            <div className="border-t pt-8">
                 <h2 className="text-2xl font-bold mb-4 text-red-600">Danger Zone</h2>
                 <p className="text-gray-600 mb-6">This will permanently delete all transaction data from the database. This action cannot be undone.</p>
                 <button onClick={handleWipeData} disabled={isWiping} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {isWiping ? 'Wiping Data...' : 'Wipe All Transactions'}
                 </button>
            </div>
        </div>
    );
}

function RecurringPage({ expenses, onAdd, onDelete }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
                <RecurringExpenseForm onSubmit={onAdd} />
            </div>
            <div className="md:col-span-2">
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-4">Recurring Monthly Expenses</h2>
                    <div className="space-y-3">
                        {expenses.length === 0 && <p className="text-center text-gray-500 py-8">No recurring expenses defined yet.</p>}
                        {expenses.map(exp => (
                            <div key={exp.id} className="flex justify-between items-center p-3 rounded-lg hover:bg-gray-50 border">
                                <div>
                                    <p className="font-semibold">{exp.description}</p>
                                    <p className="text-sm text-gray-500">{exp.category}</p>
                                </div>
                                <div className="flex items-center space-x-4">
                                     <p className="font-mono text-red-500">{CURRENCY_SYMBOLS[exp.originalCurrency] || ''}{exp.originalAmount.toLocaleString()}</p>
                                     <button onClick={() => onDelete(exp.id)} className="text-gray-400 hover:text-red-600"><TrashIcon /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function RecurringExpenseForm({ onSubmit }) {
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!description || !amount) return;
        onSubmit({ description, originalAmount: amount, originalCurrency: currency, category });
        setDescription('');
        setAmount('');
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Add Recurring Expense</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Amount</label>
                        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Currency</label>
                        <select value={currency} onChange={e => setCurrency(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                            <option>USD</option> <option>EUR</option> <option>GBP</option> <option>HUF</option>
                        </select>
                    </div>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-700">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                        {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                </div>
                <button type="submit" className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition">Add Recurring</button>
            </form>
        </div>
    );
}


function TransactionForm({ onSubmit, allTransactions }) {
    const [type, setType] = useState('Expense');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState(localStorage.getItem('lastUsedCurrency') || 'USD');
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [formError, setFormError] = useState('');

    const sortedCategories = useMemo(() => {
        const baseCategories = type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        const relevantTransactions = allTransactions.filter(t => t.type === type);
        
        const counts = relevantTransactions.reduce((acc, t) => {
            acc[t.category] = (acc[t.category] || 0) + 1;
            return acc;
        }, {});

        const sorted = baseCategories.map(c => ({ category: c, count: counts[c] || 0 }))
            .sort((a, b) => b.count - a.count);
        
        const top5 = sorted.slice(0, 5).map(item => item.category);
        const rest = baseCategories.filter(c => !top5.includes(c)).sort();
        
        return [...top5, ...rest];
    }, [allTransactions, type]);

    useEffect(() => {
        setCategory(sortedCategories[0]);
    }, [type, sortedCategories]);

    const handleCurrencyChange = (e) => {
        const newCurrency = e.target.value;
        setCurrency(newCurrency);
        localStorage.setItem('lastUsedCurrency', newCurrency);
    };

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
                        <select id="currency" value={currency} onChange={handleCurrencyChange} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                            <option>USD</option> <option>EUR</option> <option>GBP</option> <option>HUF</option>
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
                        <select id="category" value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm">
                            {sortedCategories.map(c => <option key={c}>{c}</option>)}
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
                ) : <p className="text-center text-gray-500 pt-16">No expense data to display for this period.</p>}
            </div>
        </div>
    );
}

function LineChartComponent({ data, currency }) {
    const formatXAxis = (tickItem) => {
        return new Date(tickItem + '-02').toLocaleString('default', { month: 'short', year: 'numeric' });
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Trends Over Time</h2>
            <div style={{ width: '100%', height: 300 }}>
                {data.length > 1 ? (
                    <ResponsiveContainer>
                        <LineChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" tickFormatter={formatXAxis} />
                            <YAxis />
                            <Tooltip formatter={(value) => `${CURRENCY_SYMBOLS[currency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <Legend />
                            <Line type="monotone" dataKey="expense" stroke="#ef4444" name="Expenses" dot={false} strokeWidth={2} />
                            <Line type="monotone" dataKey="income" stroke="#22c55e" name="Income" dot={false} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : <p className="text-center text-gray-500 pt-16">Not enough data to display a trend for this period.</p>}
            </div>
        </div>
    );
}


function TransactionList({ transactions, onDelete, onEdit, displayCurrency, latestRates, onNextPage, onPrevPage, currentPage, totalPages }) {
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
                                            <button onClick={() => onDelete(t.id, 'transaction')} className="text-gray-400 hover:text-red-600"><TrashIcon/></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {transactions.length === 0 && <p className="text-center text-gray-500 py-8">No transactions for the selected filters.</p>}
            </div>
             <div className="flex justify-between items-center mt-4">
                <button onClick={onPrevPage} disabled={currentPage === 1} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                <span className="text-sm text-gray-700">Page {currentPage} of {totalPages || 1}</span>
                <button onClick={onNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
            </div>
        </div>
    );
}
