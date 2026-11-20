const byId = id => document.getElementById(id);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const categories = document.querySelectorAll('[data-category]');
const tabs = document.querySelectorAll('[data-view]');
const cart = new Map();
const statusLabels = { PLACED: 'Placed', PREPARING: 'Preparing', COMPLETED: 'Completed' };
const nextStatus = { PLACED: 'PREPARING', PREPARING: 'COMPLETED' };

let dishes = [];
let currentCategory = 'Chinese';
let submitting = false;

function element(tag, className, content) {
    const node = document.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function button(className, text, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

async function request(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail ?? 'The request failed. Please try again.');
    }
    return response.json();
}

function showNotice(message = '', error = false) {
    const notice = byId('notice');
    notice.textContent = message;
    notice.classList.toggle('error', error);
    notice.hidden = !message;
}

function quantityControls(dish, quantity) {
    const add = button(quantity ? 'counter-btn' : 'add-btn', '+', event => updateCart(dish, 1, event));
    add.setAttribute('aria-label', `Add ${dish.name}`);
    add.disabled = quantity >= 99 || submitting || !dish.available;
    if (!quantity) return add;

    const subtract = button('counter-btn', '−', event => updateCart(dish, -1, event));
    subtract.setAttribute('aria-label', `Remove one ${dish.name}`);
    subtract.disabled = submitting;

    const group = element('div', 'counter-group');
    group.append(subtract, element('span', 'counter-num', quantity), add);
    return group;
}

function updateCart(dish, delta, event) {
    const quantity = (cart.get(dish.id) ?? 0) + delta;
    const container = event.currentTarget.closest('.dish-card, .cart-row').parentElement;
    const label = event.currentTarget.getAttribute('aria-label');
    if (quantity) cart.set(dish.id, quantity);
    else cart.delete(dish.id);

    renderCategory();
    renderCart();
    const controls = [...container.querySelectorAll('button:not(:disabled)')];
    const focusTarget = controls.find(node => node.getAttribute('aria-label') === label)
        ?? controls.find(node => node.getAttribute('aria-label') === `Add ${dish.name}`)
        ?? controls[0] ?? document.querySelector('.nav-item.active');
    focusTarget.focus({ preventScroll: true });
}

function renderCategory() {
    byId('menu-title').textContent = `${currentCategory} menu`;
    const list = byId('full-dish-list');
    list.replaceChildren();
    for (const dish of dishes.filter(item => item.category === currentCategory)) {
        const card = element('article', 'dish-card');
        const icon = element('span', 'dish-img', dish.icon);
        icon.setAttribute('aria-hidden', 'true');
        const info = element('div', 'dish-info');
        info.append(
            element('h3', 'dish-name', dish.name),
            element('p', 'dish-description', dish.description),
            element('p', 'dish-price', dish.available ? money.format(dish.price) : 'Sold out')
        );
        card.append(icon, info);
        if (dish.available) card.append(quantityControls(dish, cart.get(dish.id) ?? 0));
        list.append(card);
    }
    if (!list.hasChildNodes()) list.textContent = 'No dishes in this category.';
}

function renderCart() {
    const list = byId('cart-items-container');
    list.replaceChildren();
    let cents = 0;
    let count = 0;
    for (const dish of dishes) {
        const quantity = cart.get(dish.id);
        if (!quantity) continue;
        const row = element('article', 'cart-row');
        const info = element('div', '');
        info.append(element('h3', 'dish-name', dish.name), element('p', 'dish-price', money.format(dish.price)));
        row.append(info, quantityControls(dish, quantity));
        list.append(row);
        cents += Math.round(dish.price * 100) * quantity;
        count += quantity;
    }
    if (!count) list.append(element('p', 'empty', 'Your cart is empty.'));
    byId('cart-badge').textContent = count;
    byId('cart-fab').setAttribute('aria-label', `Open cart (${count} items)`);
    byId('cart-total').textContent = money.format(cents / 100);
    byId('place-order').disabled = !count || submitting;
}

async function loadDishesFromServer() {
    dishes = await request('/api/dishes');
    for (const id of cart.keys()) {
        if (!dishes.some(dish => dish.id === id && dish.available)) cart.delete(id);
    }
    renderCategory();
    renderCart();
}

async function placeOrder() {
    if (submitting || !cart.size) return;
    submitting = true;
    renderCart();
    showNotice();

    try {
        const items = Array.from(cart, ([dishId, quantity]) => ({ dishId, quantity }));
        const order = await request('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        cart.clear();
        showNotice(`Order #${order.id} placed · ${money.format(order.total)}.`);
    } catch (error) {
        showNotice(error.message, true);
        await loadDishesFromServer().catch(() => {});
    } finally {
        submitting = false;
        renderCategory();
        renderCart();
    }
}

function orderCard(order) {
    const card = element('article', 'history-card');
    const heading = element('div', 'receipt-heading');
    heading.append(
        element('h3', '', `Order #${order.id}`),
        element('span', `status ${order.status.toLowerCase()}`, statusLabels[order.status])
    );
    const list = element('ul', 'receipt-items');
    for (const item of order.items) {
        const line = element('li', 'receipt-line');
        line.append(element('span', '', `${item.quantity} × ${item.name}`),
            element('span', '', `${money.format(item.unitPrice)} each`));
        list.append(line);
    }
    const actions = element('div', 'receipt-line');
    actions.append(element('strong', '', `Total ${money.format(order.total)}`));

    const target = nextStatus[order.status];
    if (target) {
        const change = button('primary-btn', target === 'PREPARING' ? 'Start preparing' : 'Mark completed',
            async () => {
                change.disabled = true;
                showNotice();
                try {
                    const updated = await request(`/api/orders/${order.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: target })
                    });
                    showNotice(`Order #${updated.id} is ${statusLabels[updated.status].toLowerCase()}.`);
                    await renderOrders();
                } catch (error) {
                    showNotice(error.message, true);
                    change.disabled = false;
                }
            });
        actions.append(change);
    }

    card.append(heading, list, actions);
    return card;
}

async function renderOrders() {
    const list = byId('order-history-list');
    const orders = await request('/api/orders');
    list.replaceChildren(...orders.map(orderCard));
    if (!orders.length) list.append(element('p', 'empty', 'No orders yet.'));
}

function refreshOrders() {
    renderOrders().catch(error => showNotice(error.message, true));
}

function switchTab(activeView) {
    for (const tab of tabs) {
        const active = tab.dataset.view === activeView;
        byId(tab.dataset.view).hidden = !active;
        tab.classList.toggle('active', active);
        if (active) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    }
    if (activeView === 'view-cart') renderCart();
    if (activeView === 'view-order') refreshOrders();
}

for (const category of categories) {
    category.setAttribute('aria-pressed', String(category.classList.contains('active')));
    category.addEventListener('click', () => {
        currentCategory = category.dataset.category;
        for (const item of categories) {
            const active = item === category;
            item.classList.toggle('active', active);
            item.setAttribute('aria-pressed', String(active));
        }
        renderCategory();
    });
}
for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.view));
byId('cart-fab').addEventListener('click', () => switchTab('view-cart'));
byId('place-order').addEventListener('click', placeOrder);
byId('refresh-orders').addEventListener('click', refreshOrders);
renderCart();
loadDishesFromServer().catch(error => {
    byId('full-dish-list').textContent = 'Menu unavailable.';
    showNotice(error.message, true);
});
