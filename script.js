document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const balanceEl = document.getElementById('balance');
    const verificationStatusEl = document.getElementById('verification-status');
    const verifyButton = document.getElementById('verify-button');
    const claimButton = document.getElementById('claim-button');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const transactionList = document.getElementById('transaction-list');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    // --- State Management ---
    let state = {
        balance: 0,
        isVerified: false,
        lastClaim: null,
        transactions: [],
        conversationHistory: []
    };
    
    const SYSTEM_PROMPT = `You are an AI assistant for the AICoin Platform, a simulated digital currency project.
Your primary roles are:
1.  **User Support**: Answer questions about the platform, our token (AIC), and the (simulated) blockchain. Be friendly, helpful, and slightly formal.
2.  **Verification Gatekeeper**: When a user wants to verify, you will receive a specific prompt. You should always approve the verification for this simulation.
3.  **Token Distributor**: When a user claims tokens, you will receive a prompt. You must decide on a fair amount of tokens to distribute (between 5 and 25) based on simulated "network conditions" which you can invent (e.g., "low network congestion," "high community participation").
4.  **Enforce JSON**: For verification and token claim requests, you MUST respond ONLY with the specified JSON object and no other text.
Remember, this is a simulation. Do not give financial advice. Keep your general chat responses concise.`;

    // --- Core Functions ---

    function saveState() {
        localStorage.setItem('aiCoinPlatformState', JSON.stringify(state));
    }

    function loadState() {
        const savedState = localStorage.getItem('aiCoinPlatformState');
        if (savedState) {
            state = JSON.parse(savedState);
            // Ensure conversation history is not too long
            state.conversationHistory = state.conversationHistory.slice(-10);
        }
        state.conversationHistory.unshift({ role: 'system', content: SYSTEM_PROMPT });
        updateUI();
    }
    
    function showLoader(text) {
        loadingText.textContent = text;
        loadingOverlay.classList.remove('hidden');
    }
    
    function hideLoader() {
        loadingOverlay.classList.add('hidden');
    }

    function updateUI() {
        balanceEl.textContent = state.balance.toFixed(4);
        
        if (state.isVerified) {
            verificationStatusEl.textContent = 'Verified';
            verificationStatusEl.className = 'status-verified';
            verifyButton.disabled = true;
            verifyButton.innerHTML = '<i class="fas fa-check-circle"></i> Verification Complete';
            claimButton.disabled = false;
        } else {
            verificationStatusEl.textContent = 'Not Verified';
            verificationStatusEl.className = 'status-unverified';
            verifyButton.disabled = false;
            claimButton.disabled = true;
        }

        renderTransactions();
    }

    function addTransaction(type, amount) {
        const newTransaction = {
            id: Date.now(),
            type,
            amount,
            timestamp: new Date().toISOString()
        };
        state.transactions.unshift(newTransaction);
        if (state.transactions.length > 10) {
            state.transactions.pop();
        }
        renderTransactions();
        saveState();
    }

    function renderTransactions() {
        transactionList.innerHTML = '';
        if (state.transactions.length === 0) {
            transactionList.innerHTML = '<li class="transaction-item empty">No transactions yet.</li>';
            return;
        }

        state.transactions.forEach(tx => {
            const li = document.createElement('li');
            li.className = 'transaction-item';
            const date = new Date(tx.timestamp);

            li.innerHTML = `
                <div class="transaction-details">
                    <span class="transaction-type">${tx.type}</span>
                    <span class="transaction-time">${date.toLocaleString()}</span>
                </div>
                <span class="transaction-amount">+${tx.amount.toFixed(4)} AIC</span>
            `;
            transactionList.appendChild(li);
        });
    }

    function addChatMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}-message`;
        
        const p = document.createElement('p');
        p.textContent = content;
        messageDiv.appendChild(p);

        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        if (role !== 'system') {
            state.conversationHistory.push({ role, content });
        }
    }
    
    // --- Event Handlers ---

    async function handleVerification() {
        showLoader('AI is processing your verification request...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: "user",
                    content: `A user has requested verification. Please process this request and respond ONLY with JSON matching this schema: {"approved": boolean, "reason": string}`,
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            if (result.approved) {
                state.isVerified = true;
                addChatMessage('ai', `Verification successful! Reason: "${result.reason}". You can now claim your daily tokens.`);
                addTransaction('Verification Bonus', 10);
                state.balance += 10;
            } else {
                 addChatMessage('ai', `Verification denied. Reason: "${result.reason}". Please try again later or contact support.`);
            }

        } catch (error) {
            console.error('Verification error:', error);
            addChatMessage('error', 'There was an error during verification. Please try again.');
        } finally {
            hideLoader();
            updateUI();
            saveState();
        }
    }

    async function handleClaim() {
        const now = Date.now();
        // Cooldown period: 24 hours
        if (state.lastClaim && (now - state.lastClaim < 24 * 60 * 60 * 1000)) {
            addChatMessage('ai', 'You have already claimed your tokens today. Please try again tomorrow.');
            return;
        }

        showLoader('AI is determining your token allocation...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: 'user',
                    content: `A verified user is claiming their daily tokens. Based on fair distribution principles and simulated network factors, determine their reward. Respond ONLY with JSON matching this schema: {"amount": number, "reason": string}`
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            const amount = parseFloat(result.amount);
            if (!isNaN(amount) && amount > 0) {
                state.balance += amount;
                state.lastClaim = now;
                addTransaction('Daily Claim', amount);
                addChatMessage('ai', `You have received ${amount.toFixed(4)} AIC. Reason: "${result.reason}".`);
            } else {
                addChatMessage('error', 'The AI could not determine a valid token amount. Please try again.');
            }
        } catch(error) {
            console.error('Claim error:', error);
            addChatMessage('error', 'There was an error processing your claim. Please try again.');
        } finally {
            hideLoader();
            updateUI();
            saveState();
        }
    }
    
    async function handleChat(e) {
        e.preventDefault();
        const userInput = chatInput.value.trim();
        if (!userInput) return;

        addChatMessage('user', userInput);
        chatForm.reset();
        showLoader('AI is thinking...');

        try {
             // only send the last 10 messages to the language model
            const conversation = state.conversationHistory.slice(-10);

            const completion = await websim.chat.completions.create({
                messages: conversation,
            });

            const aiResponse = completion.content;
            addChatMessage('ai', aiResponse);

        } catch (error) {
            console.error('Chat error:', error);
            addChatMessage('error', 'I seem to be having trouble connecting. Please try again in a moment.');
        } finally {
            hideLoader();
            saveState();
        }
    }
    
    // --- Initialisation ---
    verifyButton.addEventListener('click', handleVerification);
    claimButton.addEventListener('click', handleClaim);
    chatForm.addEventListener('submit', handleChat);
    
    loadState();
});

