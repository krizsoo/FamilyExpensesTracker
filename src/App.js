import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, updateDoc, Timestamp, orderBy, limit, getDocs, writeBatch, startAfter } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

// --- Firebase Configuration ---
let firebaseConfig;
try {
    firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
} catch (e) {
    console.error("Firebase config is missing or invalid. Please set REACT_APP_FIREBASE_CONFIG environment variable.");
    firebaseConfig = { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", projectId: "YOUR_PROJECT_ID" };
}

// --- App & Family ID ---
// Allow overriding via env so development can use a distinct namespace.
// In .env.local set for example:
//   REACT_APP_APP_ID=family-finance-tracker-dev
//   REACT_APP_FAMILY_ID=shared-family-data-dev
// Fallback keeps existing production values.
const appId = process.env.REACT_APP_APP_ID || (process.env.NODE_ENV === 'development'
    ? 'family-finance-tracker-dev'
    : 'family-finance-tracker-v1');
const familyId = process.env.REACT_APP_FAMILY_ID || 'shared-family-data'; // Namespace for family data
const TRANSACTIONS_PER_PAGE = 25;

// --- Exchange Rate API Key ---
const EXCHANGE_RATE_API_KEY = "3a46be8bcdb0d1403ff6da95";

// --- Category Lists ---
const INCOME_CATEGORIES = ["Salary", "Extra income"];
const EXPENSE_CATEGORIES = ["Accommodation", "Beauty", "Bills", "Business", "Car", "Charity", "Clothing", "Education", "Entertainment", "Food and drinks", "Gifts", "Groceries", "Healthcare", "Hobbies", "Home", "Kids", "Other", "Savings", "Shopping", "Sport and Hobbies", "Transport", "Travel", "Utilities", "Work"];
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#da70d6', '#ffc0cb', '#3cb371', '#ffa500', '#6a5acd', '#FF5733', '#C70039', '#900C3F', '#581845'];
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', HUF: 'Ft' };

// --- Helper Components & Icons ---
const Toast = ({ message, type, onClose }) => (<div className={`fixed top-5 right-5 p-4 rounded-lg shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}><span>{message}</span><button onClick={onClose} className="ml-4 font-bold">X</button></div>);
const ConfirmationModal = ({ message, onConfirm, onCancel }) => (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><div className="bg-white rounded-lg p-8 shadow-2xl w-11/12 md:w-1/3"><h3 className="text-lg font-bold mb-4">Confirm Action</h3><p className="mb-6">{message}</p><div className="flex justify-end space-x-4"><button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition">Cancel</button><button onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition">Delete</button></div></div></div>);
const TrashIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>);
const PencilIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg>);
const SortIcon = ({ direction }) => direction ? (direction === 'asc' ? ' ▲' : ' ▼') : null;
const ChevronDown = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"></path></svg>;
const ChevronUp = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"></path></svg>;

const CollapsibleCard = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="bg-white rounded-lg shadow-md">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center p-4 font-bold text-lg"
            >
                <span>{title}</span>
                {isOpen ? <ChevronUp /> : <ChevronDown />}
            </button>
            {isOpen && <div className="p-4 border-t">{children}</div>}
        </div>
    );
};

// Convert a JS Date (or date-like) to local YYYY-MM-DD (ISO-style) string
const dateToLocalISO = (date) => {
    const d = (date instanceof Date) ? date : new Date(date);
    const tzOffset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tzOffset * 60000);
    return local.toISOString().split('T')[0];
};

// Debug hook placeholder — exists so code can call it regardless of dev instrumentation
const debugSetLoading = (val, reason) => {
    if (process.env.NODE_ENV === 'development') {
        if (val) console.warn('[debugSetLoading] true', reason);
        else console.log('[debugSetLoading] false', reason);
    }
};

// --- Main App Component ---
export default function App() {
    const [auth, setAuth] = useState(null);
    const [user, setUser] = useState(null);
    // We no longer block the UI with a global spinner; keep only the setter for internal timing
    const [, setIsLoading] = useState(true);
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
            // Add a debug log so we can see whether the auth listener fires.
            const fallbackRef = { id: null };
            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                console.warn('[Auth] onAuthStateChanged fired, user=', !!user);
                setUser(user);
                setIsLoading(false);
                if (fallbackRef.id) {
                    clearTimeout(fallbackRef.id);
                    fallbackRef.id = null;
                }
            });
            // Fallback: if auth state didn't arrive in 15s, stop showing a blocking spinner.
            fallbackRef.id = setTimeout(() => {
                console.warn('[Auth] onAuthStateChanged did not fire within 15s, clearing loading overlay');
                setIsLoading(false);
                fallbackRef.id = null;
            }, 15000);
            return () => { unsubscribe(); if (fallbackRef.id) clearTimeout(fallbackRef.id); };
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

    // No global spinner overlay — keep the app interactive while auth initializes
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
    const [lastTxnDoc, setLastTxnDoc] = useState(null);
    const [hasMoreTxns, setHasMoreTxns] = useState(false);
    const [loadingTxns, setLoadingTxns] = useState(false);
    const [recurringItems, setRecurringItems] = useState([]);
    const [displayCurrency, setDisplayCurrency] = useState(localStorage.getItem('lastReportCurrency') || 'USD');
    const [selectedMonths, setSelectedMonths] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [descriptionFilter, setDescriptionFilter] = useState("");
    const [latestRates, setLatestRates] = useState(null);
    // Remove page-level blocking spinner; keep only setter for async ops
    const [, setIsLoading] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const [showConfirmModal, setShowConfirmModal] = useState({ show: false, id: null, type: '' });
    const [editingTransaction, setEditingTransaction] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [initialMonthSet, setInitialMonthSet] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'transactionDate', direction: 'desc' });
    // Used to prevent pushState when the page state was just set from a popstate event
    const suppressPushRef = useRef(false);
    // Persisted category usage (separate for Expense / Income so dashboard frequency works w/out Reports loaded)
    const [categoryUsage, setCategoryUsage] = useState(() => {
        try {
            const raw = localStorage.getItem('categoryUsageV1');
            if (raw) return JSON.parse(raw);
        } catch {}
        return { Expense: {}, Income: {} };
    });

    useEffect(() => {
        try { localStorage.setItem('categoryUsageV1', JSON.stringify(categoryUsage)); } catch {}
    // Expose lightweight cache for child components without prop-drilling (simple, non-secure)
    try { window.__categoryUsageCache = categoryUsage; } catch {}
    }, [categoryUsage]);

    const incrementCategoryUsage = useCallback((type, category, delta = 1) => {
        if (!type || !category) return;
        setCategoryUsage(prev => {
            const next = { ...prev, [type]: { ...prev[type] } };
            next[type][category] = (next[type][category] || 0) + delta;
            return next;
        });
    }, []);

    const rebuildCategoryUsageFromTransactions = useCallback((txns) => {
        const usage = { Expense: {}, Income: {} };
        txns.forEach(t => {
            if (!t || !t.type || !t.category) return;
            usage[t.type][t.category] = (usage[t.type][t.category] || 0) + 1;
        });
        setCategoryUsage(usage);
    }, []);

    // Helpers for month math
    const prevYearMonth = (ym) => {
        const d = new Date(ym + '-01T00:00:00');
        d.setMonth(d.getMonth() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    };
    const currentAndPreviousYM = () => {
        const now = new Date();
        const cur = dateToLocalISO(now).slice(0, 7);
        return { cur, prev: prevYearMonth(cur) };
    };

    useEffect(() => {
        try {
            if (!getApps().length) {
                initializeApp(firebaseConfig);
            }
            setDb(getFirestore());
        } catch (e) {
            console.warn('Failed to initialize Firestore in FinanceTracker', e);
        }
    }, []);

    // Sync page state with browser URL (simple history integration)
    useEffect(() => {
        const syncFromLocation = () => {
            const p = window.location.pathname || '/';
            // Indicate that the next page change was triggered by popstate so the push effect should skip pushing.
            suppressPushRef.current = true;
            if (p === '/reports') {
                setPage('reports');
                // Reset any previous transaction pagination state when navigating directly
                setAllTransactions([]);
                setLastTxnDoc(null);
                setHasMoreTxns(false);
                setLoadingTxns(false);
            } else {
                setPage('dashboard');
            }
        };
        window.addEventListener('popstate', syncFromLocation);
        // Initial sync from location should not create an extra history entry (we set suppressPushRef to skip the first push)
        syncFromLocation();
        return () => window.removeEventListener('popstate', syncFromLocation);
    }, []);

    // Push URL when page changes
    useEffect(() => {
        // If the page change originated from popstate or the initial sync, skip pushing a new history entry.
        if (suppressPushRef.current) {
            suppressPushRef.current = false;
            return;
        }
        try {
            if (page === 'reports') window.history.pushState({}, '', '/reports');
            else window.history.pushState({}, '', '/');
        } catch (e) {
            // ignore
        }
    }, [page]);
    
    useEffect(() => {
        localStorage.setItem('lastReportCurrency', displayCurrency);
    }, [displayCurrency]);

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type }), 4000);
    };

    // Recurring items — only when Reports page is active
    useEffect(() => {
        if (!db) return;

        let unsubscribeSummary = null;
        let unsubscribeRecurring = null;
        let unsubscribeLiveMonths = null;

        // Recurring items are small; only load when on reports page to be safe
        if (page === 'reports') {
            console.warn('[Firestore] Attaching recurring listener');
            const recurringQuery = query(collection(db, `artifacts/${appId}/families/${familyId}/recurring`), orderBy('createdAt', 'desc'));
            unsubscribeRecurring = onSnapshot(recurringQuery, (snapshot) => {
                console.warn('[Firestore] recurring snapshot size=', snapshot.size);
                const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                setRecurringItems(data);
            });

            // Live updates for current + previous months
            const { prev } = (function() {
                const now = new Date();
                const cur = dateToLocalISO(now).slice(0, 7);
                const d = new Date(cur + '-01T00:00:00');
                d.setMonth(d.getMonth() - 1);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                return { cur, prev: `${y}-${m}` };
            })();
            console.warn('[Firestore] Attaching live txns listener for latest window');
            const txRef = collection(db, `artifacts/${appId}/families/${familyId}/transactions`);
            // Listen to latest N docs; then filter to current+previous months in-memory to avoid Firestore type issues
            const liveQuery = query(txRef, orderBy('transactionDate', 'desc'), limit(500));
            unsubscribeLiveMonths = onSnapshot(liveQuery, (snapshot) => {
                const live = snapshot.docs.map(d => {
                    const docData = d.data();
                    if (docData.transactionDate && docData.transactionDate.toDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate.toDate());
                    } else if (docData.transactionDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate);
                    } else {
                        docData.transactionDate = dateToLocalISO(new Date());
                    }
                    return { id: d.id, ...docData };
                }).filter(x => getYearMonthLocal(x.transactionDate) >= prev);
                setAllTransactions(prevState => {
                    const older = prevState.filter(t => getYearMonthLocal(t.transactionDate) < prev);
                    return [...live, ...older];
                });
            });
        }

        return () => {
            if (unsubscribeSummary) unsubscribeSummary();
            if (unsubscribeRecurring) unsubscribeRecurring();
            if (unsubscribeLiveMonths) unsubscribeLiveMonths();
        };
    }, [db, page]);

    // Reports transactions: load only when page === 'reports' using explicit pagination (no real-time listener)
    // Reports transactions: initial load includes current month + previous month
    const fetchInitialTransactions = useCallback(async () => {
        if (!db) return;
        setLoadingTxns(true);
        try {
            const ref = collection(db, `artifacts/${appId}/families/${familyId}/transactions`);
            const { prev } = currentAndPreviousYM();
            let lastDoc = null;
            let accum = [];
            let crossedBoundary = false;
            while (true) {
                const q = lastDoc
                    ? query(ref, orderBy('transactionDate', 'desc'), startAfter(lastDoc), limit(TRANSACTIONS_PER_PAGE))
                    : query(ref, orderBy('transactionDate', 'desc'), limit(TRANSACTIONS_PER_PAGE));
                const snap = await getDocs(q);
                if (snap.empty) { setHasMoreTxns(false); break; }
                console.warn('[Firestore] initial batch size=', snap.size);
                const mapped = snap.docs.map(d => {
                    const docData = d.data();
                    if (docData.transactionDate && docData.transactionDate.toDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate.toDate());
                    } else if (docData.transactionDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate);
                    } else {
                        docData.transactionDate = dateToLocalISO(new Date());
                    }
                    return { id: d.id, __doc: d, ...docData };
                });
                // Keep current and previous months only
                const kept = mapped.filter(x => getYearMonthLocal(x.transactionDate) >= prev);
                accum = accum.concat(kept.map(({ __doc, ...rest }) => rest));
                lastDoc = snap.docs[snap.docs.length - 1];
                const lastMapped = mapped[mapped.length - 1];
                if (lastMapped && getYearMonthLocal(lastMapped.transactionDate) < prev) {
                    crossedBoundary = true;
                }
                if (crossedBoundary) { setHasMoreTxns(true); break; }
                if (snap.size < TRANSACTIONS_PER_PAGE) { setHasMoreTxns(false); break; }
            }
            setAllTransactions(accum);
            setLastTxnDoc(lastDoc);
        // Rebuild usage from the two months we have so far if we have more info than current cache
        rebuildCategoryUsageFromTransactions(accum);
        } finally {
            setLoadingTxns(false);
        }
    }, [db, rebuildCategoryUsageFromTransactions]);

    // Load one older month
    const fetchMoreTransactions = useCallback(async () => {
        if (!db || !lastTxnDoc || !hasMoreTxns) return;
        setLoadingTxns(true);
        try {
            // Find oldest loaded month, then target its previous month
            const oldestLoadedMonth = (allTransactions.length > 0)
                ? allTransactions.reduce((min, t) => {
                    const m = getYearMonthLocal(t.transactionDate);
                    return min === null || m < min ? m : min;
                }, null)
                : null;
            if (!oldestLoadedMonth) { setLoadingTxns(false); return; }
            const targetMonth = prevYearMonth(oldestLoadedMonth);

            const ref = collection(db, `artifacts/${appId}/families/${familyId}/transactions`);
            let localLast = lastTxnDoc;
            let append = [];
            let done = false;
            while (!done) {
                const q = localLast
                    ? query(ref, orderBy('transactionDate', 'desc'), startAfter(localLast), limit(TRANSACTIONS_PER_PAGE))
                    : query(ref, orderBy('transactionDate', 'desc'), limit(TRANSACTIONS_PER_PAGE));
                const snap = await getDocs(q);
                if (snap.empty) { setHasMoreTxns(false); break; }
                const mapped = snap.docs.map(d => {
                    const docData = d.data();
                    if (docData.transactionDate && docData.transactionDate.toDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate.toDate());
                    } else if (docData.transactionDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate);
                    } else {
                        docData.transactionDate = dateToLocalISO(new Date());
                    }
                    return { id: d.id, __doc: d, ...docData };
                });
                const kept = mapped.filter(x => getYearMonthLocal(x.transactionDate) === targetMonth);
                append = append.concat(kept.map(({ __doc, ...rest }) => rest));
                localLast = snap.docs[snap.docs.length - 1];
                const lastMapped = mapped[mapped.length - 1];
                const lastMonth = lastMapped ? getYearMonthLocal(lastMapped.transactionDate) : null;
                if (!lastMonth || lastMonth < targetMonth || snap.size < TRANSACTIONS_PER_PAGE) {
                    done = true;
                    setHasMoreTxns(!!lastMonth && lastMonth <= targetMonth && snap.size === TRANSACTIONS_PER_PAGE);
                }
            }
            setAllTransactions(prev => [...prev, ...append]);
            setLastTxnDoc(localLast || lastTxnDoc);
        // Extend usage with the newly appended month
        rebuildCategoryUsageFromTransactions([...allTransactions, ...append]);
        } finally {
            setLoadingTxns(false);
        }
    }, [db, lastTxnDoc, hasMoreTxns, allTransactions, rebuildCategoryUsageFromTransactions]);

    // Load all remaining
    const fetchAllTransactions = useCallback(async () => {
        if (!db) return;
        setLoadingTxns(true);
        try {
            const ref = collection(db, `artifacts/${appId}/families/${familyId}/transactions`);
            let localLast = lastTxnDoc;
            let accum = [];
            while (true) {
                const q = localLast
                    ? query(ref, orderBy('transactionDate', 'desc'), startAfter(localLast), limit(TRANSACTIONS_PER_PAGE))
                    : query(ref, orderBy('transactionDate', 'desc'), limit(TRANSACTIONS_PER_PAGE));
                const snap = await getDocs(q);
                if (snap.empty) { setHasMoreTxns(false); break; }
                const mapped = snap.docs.map(d => {
                    const docData = d.data();
                    if (docData.transactionDate && docData.transactionDate.toDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate.toDate());
                    } else if (docData.transactionDate) {
                        docData.transactionDate = dateToLocalISO(docData.transactionDate);
                    } else {
                        docData.transactionDate = dateToLocalISO(new Date());
                    }
                    return { id: d.id, ...docData };
                });
                accum = accum.concat(mapped);
                localLast = snap.docs[snap.docs.length - 1];
                if (snap.size < TRANSACTIONS_PER_PAGE) { setHasMoreTxns(false); break; }
            }
            setAllTransactions(prev => [...prev, ...accum]);
            setLastTxnDoc(localLast || lastTxnDoc);
        // Full rebuild for entire dataset loaded
        rebuildCategoryUsageFromTransactions([...allTransactions, ...accum]);
        } finally {
            setLoadingTxns(false);
        }
    }, [db, lastTxnDoc, allTransactions, rebuildCategoryUsageFromTransactions]);

    // Trigger initial fetch when entering Reports
    useEffect(() => {
        if (!db) return;
        if (page === 'reports' && allTransactions.length === 0 && !loadingTxns) {
            fetchInitialTransactions();
        }
    }, [db, page, fetchInitialTransactions, loadingTxns, allTransactions.length]);

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

    // Always get year and month in Hungary timezone
    // For date string YYYY-MM-DD, just return YYYY-MM
    const getYearMonthLocal = (dateStr) => dateStr.slice(0, 7);

    const availableMonths = useMemo(() => {
        const months = new Set(allTransactions.map(t => getYearMonthLocal(t.transactionDate)));
        return Array.from(months).sort().reverse();
    }, [allTransactions]);

    useEffect(() => {
        if (availableMonths.length > 0 && !initialMonthSet) {
            setSelectedMonths([availableMonths[0]]);
            setInitialMonthSet(true);
        }
    }, [availableMonths, initialMonthSet]);

    const filteredTransactions = useMemo(() => {
        let transactions = [...allTransactions]; // Create a mutable copy

        if (selectedMonths.length > 0) {
            transactions = transactions.filter(t => selectedMonths.includes(getYearMonthLocal(t.transactionDate)));
        }

        if (selectedCategories.length > 0) {
            transactions = transactions.filter(t => selectedCategories.includes(t.category));
        }
        
        if (descriptionFilter) {
            transactions = transactions.filter(t => t.description.toLowerCase().includes(descriptionFilter.toLowerCase()));
        }
        
        // Sorting logic
        transactions.sort((a, b) => {
            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            if(sortConfig.key === 'amountInBaseCurrency') {
                 if (a.originalCurrency === displayCurrency) aValue = a.originalAmount;
                 else aValue = a.amountInBaseCurrency * (latestRates ? latestRates[displayCurrency] || 1 : 1);
                 
                 if (b.originalCurrency === displayCurrency) bValue = b.originalAmount;
                 else bValue = b.amountInBaseCurrency * (latestRates ? latestRates[displayCurrency] || 1 : 1);
            }

            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return transactions;
    }, [allTransactions, selectedMonths, selectedCategories, descriptionFilter, sortConfig, displayCurrency, latestRates]);
    
    const paginatedTransactions = useMemo(() => {
        const startIndex = (currentPage - 1) * TRANSACTIONS_PER_PAGE;
        const endIndex = startIndex + TRANSACTIONS_PER_PAGE;
        return filteredTransactions.slice(startIndex, endIndex);
    }, [filteredTransactions, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [selectedMonths, selectedCategories, descriptionFilter]);

    const totalPages = Math.ceil(filteredTransactions.length / TRANSACTIONS_PER_PAGE);

    const addTransaction = useCallback(async (data) => {
        if (!db || !latestRates) { showToast("Data not ready, please try again.", "error"); return; }
        setIsLoading(true);
        try {
            const { originalAmount, originalCurrency } = data;
            const rate = latestRates[originalCurrency] || 1;
            const amountInBase = originalAmount / rate;
            const collectionPath = `artifacts/${appId}/families/${familyId}/transactions`;
            // Store transactionDate as string YYYY-MM-DD
            await addDoc(collection(db, collectionPath), { ...data, originalAmount: parseFloat(originalAmount), transactionDate: data.transactionDate, baseCurrency: 'USD', exchangeRateToBase: rate, amountInBaseCurrency: parseFloat(amountInBase), createdAt: Date.now() });
        incrementCategoryUsage(data.type, data.category);
            showToast(`${data.type} added successfully!`);
        } catch (e) { showToast(`Failed to add transaction: ${e.message}`, 'error'); } finally { setIsLoading(false); }
    }, [db, latestRates, incrementCategoryUsage]);

    const updateTransaction = useCallback(async (updatedData) => {
        if (!db || !editingTransaction || !latestRates) { showToast("Data not ready, please try again.", "error"); return; }
        setIsLoading(true);
        try {
            const docRef = doc(db, `artifacts/${appId}/families/${familyId}/transactions`, editingTransaction.id);
            const { originalAmount, originalCurrency } = updatedData;
            const rate = latestRates[originalCurrency] || 1;
            const amountInBase = originalAmount / rate;
            // Store transactionDate as string YYYY-MM-DD
            const payload = { ...updatedData, originalAmount: parseFloat(originalAmount), transactionDate: updatedData.transactionDate, baseCurrency: 'USD', exchangeRateToBase: rate, amountInBaseCurrency: parseFloat(amountInBase) };
            await updateDoc(docRef, payload);
        incrementCategoryUsage(updatedData.type, updatedData.category);
            showToast("Transaction updated!");
            setEditingTransaction(null);
        } catch (e) { showToast(`Update failed: ${e.message}`, 'error'); } finally { setIsLoading(false); }
    }, [db, editingTransaction, latestRates, incrementCategoryUsage]);

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

    const addRecurringItem = useCallback(async (data) => {
        if (!db) { showToast("Database not ready", "error"); return; }
        setIsLoading(true);
        try {
            const collectionPath = `artifacts/${appId}/families/${familyId}/recurring`;
            await addDoc(collection(db, collectionPath), { ...data, originalAmount: parseFloat(data.originalAmount), createdAt: Timestamp.now() });
            showToast('Recurring item added!');
        } catch(e) { showToast(`Failed to add: ${e.message}`, 'error'); }
        finally { setIsLoading(false); }
    }, [db]);
    
    const handlePostRecurring = useCallback(async () => {
        if (!db || !latestRates) { showToast("Data not ready", "error"); return; }
        
        const currentMonthStr = new Date().toISOString().slice(0, 7);
        const currentMonthTransactions = allTransactions.filter(t => getYearMonthLocal(t.transactionDate) === currentMonthStr);
        
        const toAdd = recurringItems.filter(recurring => 
            !currentMonthTransactions.some(t => t.description === recurring.description)
        );

        if (toAdd.length === 0) {
            showToast("All recurring items for this month are already added.", "success");
            return;
        }

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const collectionPath = `artifacts/${appId}/families/${familyId}/transactions`;
            
        toAdd.forEach(item => {
                const { originalAmount, originalCurrency } = item;
                const rate = latestRates[originalCurrency] || 1;
                const amountInBase = originalAmount / rate;
                const newTransaction = {
                    ...item,
                    originalAmount: parseFloat(originalAmount),
            // Store as local YYYY-MM-DD string for consistency
            transactionDate: dateToLocalISO(new Date()),
                    baseCurrency: 'USD',
                    exchangeRateToBase: rate,
                    amountInBaseCurrency: parseFloat(amountInBase),
            createdAt: Timestamp.now(),
                };
                const docRef = doc(collection(db, collectionPath));
                batch.set(docRef, newTransaction);
            });

            await batch.commit();
            showToast(`Added ${toAdd.length} recurring item(s).`);
        } catch (e) {
            showToast(`Failed to add recurring items: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [db, latestRates, allTransactions, recurringItems]);

    const reportData = useMemo(() => {
        if (!latestRates) return { totalExpense: 0, totalIncome: 0, netBalance: 0, expenseChartData: [], trendChartData: [] };
        
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
            
            let amount;
            if (t.originalCurrency === displayCurrency) {
                amount = t.originalAmount;
            } else {
                amount = t.amountInBaseCurrency * conversionRate;
            }

            if (t.type === 'Expense') {
                acc[month].expense += amount;
            } else {
                acc[month].income += amount;
            }
            return acc;
        }, {});

        const trendChartData = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));

        return { totalExpense, totalIncome, netBalance: totalIncome - totalExpense, expenseChartData, trendChartData };
    }, [filteredTransactions, displayCurrency, latestRates]);

    return (
        <div className="bg-gray-100 min-h-screen font-sans text-gray-800">
            {/* Removed page-level loading overlay */}
            {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast(t => ({ ...t, show: false }))} />}
            {showConfirmModal.show && <ConfirmationModal message={`Are you sure you want to permanently delete this ${showConfirmModal.type}?`} onConfirm={handleConfirmDelete} onCancel={() => setShowConfirmModal({ show: false, id: null, type: '' })} />}
            {editingTransaction && <EditModal transaction={editingTransaction} allTransactions={allTransactions} onSave={updateTransaction} onCancel={() => setEditingTransaction(null)} />}
            
            <header className="bg-white shadow-md">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                         <h1 className="text-3xl font-bold text-blue-600">Family Finance</h1>
                                 <nav className="hidden md:flex space-x-2 rounded-lg bg-gray-200 p-1">
                                     <button onClick={() => setPage('dashboard')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'dashboard' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Dashboard</button>
                                     <button onClick={() => setPage('reports')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'reports' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Reports</button>
                                     <button onClick={() => setPage('recurring')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'recurring' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Recurring</button>
                                     <button onClick={() => setPage('import')} className={`px-3 py-1 rounded-md text-sm font-semibold ${page === 'import' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>Import</button>
                                 </nav>
                    </div>
                    <div className="hidden md:block">
                        <button onClick={onSignOut} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition">Sign Out</button>
                    </div>
                    <div className="md:hidden">
                        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-gray-600">
                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                        </button>
                    </div>
                </div>
                {isMenuOpen && (
                    <div className="md:hidden bg-white border-t">
                        <nav className="flex flex-col p-4 space-y-2">
                            <button onClick={() => { setPage('dashboard'); setIsMenuOpen(false); }} className="text-left p-2 rounded-md hover:bg-gray-100">Dashboard</button>
                            <button onClick={() => { setPage('reports'); setIsMenuOpen(false); }} className="text-left p-2 rounded-md hover:bg-gray-100">Reports</button>
                            <button onClick={() => { setPage('recurring'); setIsMenuOpen(false); }} className="text-left p-2 rounded-md hover:bg-gray-100">Recurring</button>
                            <button onClick={() => { setPage('import'); setIsMenuOpen(false); }} className="text-left p-2 rounded-md hover:bg-gray-100">Import</button>
                            <button onClick={onSignOut} className="text-left p-2 rounded-md text-red-600 hover:bg-red-50">Sign Out</button>
                        </nav>
                    </div>
                )}
            </header>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {page === 'dashboard' && (
                    <div className="grid grid-cols-1 gap-8">
                        <div className="space-y-8">
                            <TransactionForm onSubmit={addTransaction} allTransactions={allTransactions} />
                        </div>
                    </div>
                )}

                {page === 'reports' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 space-y-8">
                            <CollapsibleCard title="Summary" defaultOpen={true}>
                                <SummaryReport summary={reportData} currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
                            </CollapsibleCard>
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <CollapsibleCard title="Filters" defaultOpen={true}>
                                <MonthFilter availableMonths={availableMonths} selectedMonths={selectedMonths} onSelectionChange={setSelectedMonths} />
                                <CategoryFilter selectedCategories={selectedCategories} onSelectionChange={setSelectedCategories} />
                            </CollapsibleCard>
                             <CollapsibleCard title="Charts" defaultOpen={true}>
                                <CategoryChart data={reportData.expenseChartData} currency={displayCurrency} />
                                <TrendChartComponent data={reportData.trendChartData} currency={displayCurrency} />
                            </CollapsibleCard>
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <TransactionList
                                    transactions={paginatedTransactions}
                                    onDelete={(id) => requestDelete(id, 'transaction')}
                                    onEdit={setEditingTransaction}
                                    displayCurrency={displayCurrency}
                                    latestRates={latestRates}
                                    onNextPage={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                                    onPrevPage={() => setCurrentPage(p => Math.max(p - 1, 1))}
                                    currentPage={currentPage}
                                    totalPages={totalPages}
                                    sortConfig={sortConfig}
                                    setSortConfig={setSortConfig}
                                    descriptionFilter={descriptionFilter}
                                    setDescriptionFilter={setDescriptionFilter}
                                />
                                <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
                                    <div className="text-sm text-gray-500">{loadingTxns ? 'Loading…' : hasMoreTxns ? '' : 'No more transactions'}</div>
                                    <div className="flex gap-2 ml-auto">
                                        {hasMoreTxns && (
                                            <button onClick={fetchMoreTransactions} disabled={loadingTxns} className="px-4 py-2 bg-gray-200 text-gray-800 rounded disabled:opacity-50">
                                                {loadingTxns ? 'Loading…' : 'Load more (1 month)'}
                                            </button>
                                        )}
                                        <button onClick={fetchAllTransactions} disabled={loadingTxns || !hasMoreTxns} className="px-4 py-2 bg-gray-200 text-gray-800 rounded disabled:opacity-50">
                                            {loadingTxns ? 'Loading…' : 'Load all transactions'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {page === 'recurring' && (
                    <RecurringPage expenses={recurringItems} onAdd={addRecurringItem} onDelete={(id) => requestDelete(id, 'recurring')} onPostRecurring={handlePostRecurring} allTransactions={allTransactions} />
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
        <div>
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
    const allCategories = useMemo(() => [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES], []);

    const handleCategoryClick = (category) => {
        if (category === 'All') {
            // Toggle: if all are selected, clear; otherwise select all
            const allSelected = allCategories.every(c => selectedCategories.includes(c));
            onSelectionChange(allSelected ? [] : allCategories);
            return;
        }
        const newSelection = selectedCategories.includes(category)
            ? selectedCategories.filter(c => c !== category)
            : [...selectedCategories, category];
        onSelectionChange(newSelection);
    };

    const isAllSelected = selectedCategories.length === 0 || allCategories.every(c => selectedCategories.includes(c));

    return (
        <div className="mt-4">
                <div className="flex justify-between items-center mb-3">
                 <h3 className="text-lg font-bold">Filter by Category</h3>
                 <button
                    onClick={() => handleCategoryClick('All')}
                    className={`px-3 py-1 text-sm rounded-full transition ${isAllSelected ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
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

function RecurringPage({ expenses, onAdd, onDelete, onPostRecurring, allTransactions }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
                <RecurringItemForm onSubmit={onAdd} allTransactions={allTransactions} />
            </div>
            <div className="md:col-span-2">
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold">Recurring Monthly Items</h2>
                        <button onClick={onPostRecurring} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md transition">Add for this Month</button>
                    </div>
                    <div className="space-y-3">
                        {expenses.length === 0 && <p className="text-center text-gray-500 py-8">No recurring items defined yet.</p>}
                        {expenses.map(exp => (
                            <div key={exp.id} className="flex justify-between items-center p-3 rounded-lg hover:bg-gray-50 border">
                                <div>
                                    <p className="font-semibold">{exp.description}</p>
                                    <p className="text-sm text-gray-500">{exp.category}</p>
                                </div>
                                <div className="flex items-center space-x-4">
                                     <p className={`font-mono ${exp.type === 'Income' ? 'text-green-500' : 'text-red-500'}`}>{CURRENCY_SYMBOLS[exp.originalCurrency] || ''}{exp.originalAmount.toLocaleString()}</p>
                                     <button onClick={() => onDelete(exp.id, 'recurring')} className="text-gray-400 hover:text-red-600"><TrashIcon /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function RecurringItemForm({ onSubmit, allTransactions }) {
    const [type, setType] = useState('Expense');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);

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

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!description || !amount) return;
        onSubmit({ type, description, originalAmount: amount, originalCurrency: currency, category });
        setDescription('');
        setAmount('');
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Add Recurring Item</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-200 p-1 mb-4">
                    <button type="button" onClick={() => setType('Expense')} className={`py-2 rounded-md font-semibold ${type === 'Expense' ? 'bg-red-500 text-white shadow' : 'text-gray-600'}`}>Expense</button>
                    <button type="button" onClick={() => setType('Income')} className={`py-2 rounded-md font-semibold ${type === 'Income' ? 'bg-green-500 text-white shadow' : 'text-gray-600'}`}>Income</button>
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
                        {sortedCategories.map(c => <option key={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} required className="mt-1 block w-full px-3 py-2 border-gray-300 rounded-md shadow-sm" />
                </div>
                <button type="submit" className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition">Add Recurring Item</button>
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
        // Pull persisted usage if available (attached to FinanceTracker via closure)
        const usage = (window.__categoryUsageCache || {}); // fallback if not injected
        const baseCategories = type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        const counts = usage[type] || {};
        const ranked = baseCategories.map(c => ({ c, n: counts[c] || 0 }))
            .sort((a, b) => b.n - a.n);
        const top5 = ranked.slice(0, 5).map(r => r.c);
        const rest = baseCategories.filter(c => !top5.includes(c)).sort();
        return [...top5, ...rest];
    }, [type]);

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

function EditModal({ transaction, onSave, onCancel, allTransactions = [] }) {
    const [formData, setFormData] = useState({
        ...transaction,
        transactionDate: typeof transaction.transactionDate === 'string'
            ? transaction.transactionDate
            : (transaction.transactionDate && transaction.transactionDate.toISOString)
                ? transaction.transactionDate.toISOString().split('T')[0]
                : ''
    });

    useEffect(() => {
        const categories = formData.type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        if (!categories.includes(formData.category)) {
            setFormData(prev => ({ ...prev, category: categories[0] }));
        }
    }, [formData.type, formData.category]);

    // Build frequency-based ordering (top 5 then alphabetical rest)
    const sortedCategories = useMemo(() => {
        const usage = (window.__categoryUsageCache || {});
        const baseCategories = formData.type === 'Expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
        const counts = usage[formData.type] || {};
        const ranked = baseCategories.map(c => ({ c, n: counts[c] || 0 }))
            .sort((a, b) => b.n - a.n);
        const top5 = ranked.slice(0, 5).map(r => r.c);
        const rest = baseCategories.filter(c => !top5.includes(c)).sort();
        return [...top5, ...rest];
    }, [formData.type]);

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
                                {sortedCategories.map(c => <option key={c}>{c}</option>)}
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
        <div className="p-4">
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
        <div>
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

function TrendChartComponent({ data, currency }) {
    const formatXAxis = (tickItem) => {
        return new Date(tickItem + '-02').toLocaleString('default', { month: 'short', year: 'numeric' });
    };

    return (
        <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Trends Over Time</h2>
            <div style={{ width: '100%', height: 300 }}>
                {data.length > 0 ? (
                    <ResponsiveContainer>
                        <BarChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" tickFormatter={formatXAxis} />
                            <YAxis />
                            <Tooltip formatter={(value) => `${CURRENCY_SYMBOLS[currency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <Legend />
                            <Bar dataKey="expense" fill="#ef4444" name="Expenses" />
                            <Bar dataKey="income" fill="#22c55e" name="Income" />
                        </BarChart>
                    </ResponsiveContainer>
                ) : <p className="text-center text-gray-500 pt-16">No data to display a trend for this period.</p>}
            </div>
        </div>
    );
}


function TransactionList({ transactions, onDelete, onEdit, displayCurrency, latestRates, onNextPage, onPrevPage, currentPage, totalPages, sortConfig, setSortConfig, descriptionFilter, setDescriptionFilter }) {
    const conversionRate = latestRates ? latestRates[displayCurrency] || 1 : 1;
    const formatCurrency = (value) => `${CURRENCY_SYMBOLS[displayCurrency] || ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Transaction History</h2>
                <input 
                    type="text" 
                    placeholder="Search descriptions..."
                    value={descriptionFilter}
                    onChange={(e) => setDescriptionFilter(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md"
                />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th scope="col" className="px-4 py-3 cursor-pointer" onClick={() => requestSort('transactionDate')}>Date<SortIcon direction={sortConfig.key === 'transactionDate' ? sortConfig.direction : null} /></th>
                            <th scope="col" className="px-4 py-3 text-right cursor-pointer" onClick={() => requestSort('amountInBaseCurrency')}>Amount ({displayCurrency})<SortIcon direction={sortConfig.key === 'amountInBaseCurrency' ? sortConfig.direction : null} /></th>
                            <th scope="col" className="px-4 py-3 cursor-pointer" onClick={() => requestSort('category')}>Category<SortIcon direction={sortConfig.key === 'category' ? sortConfig.direction : null} /></th>
                            <th scope="col" className="px-4 py-3">Description</th>
                            <th scope="col" className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {transactions.map(t => {
                            const isExpense = t.type === 'Expense';
                            let displayAmount;
                            if (t.originalCurrency === displayCurrency) {
                                displayAmount = t.originalAmount;
                            } else {
                                displayAmount = t.amountInBaseCurrency * conversionRate;
                            }
                            
                            return (
                                <tr key={t.id} className="bg-white border-b hover:bg-gray-50">
                                    <td className="px-4 py-3">{t.transactionDate}</td>
                                    <td className={`px-4 py-3 text-right font-semibold font-mono ${isExpense ? 'text-red-500' : 'text-green-500'}`}>
                                        {isExpense ? '-' : '+'}{formatCurrency(displayAmount)}
                                    </td>
                                    <td className="px-4 py-3">{t.category}</td>
                                    <td className="px-4 py-3 font-medium text-gray-900">{t.description || '-'}</td>
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
