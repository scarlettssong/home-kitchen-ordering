const byId = id => document.getElementById(id);
const maxPerDish = 3;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const categories = document.querySelectorAll('[data-category]');
const tabs = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('main[id]');
const dialog = byId('dish-modal');
const categoryLabels = { Chinese: '中餐', Western: '西餐', Japanese: '日料', Dessert: '甜品' };
const cart = new Map();
const statusLabels = { PLACED: '已下单', PREPARING: '制作中', COMPLETED: '已完成' };
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
        throw new Error(error.detail ?? '请求失败，请稍后重试。');
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
    add.setAttribute('aria-label', `增加一份${dish.name}`);
    add.disabled = quantity >= maxPerDish || submitting || !dish.available;
    if (!quantity) return add;

    const subtract = button('counter-btn', '−', event => updateCart(dish, -1, event));
    subtract.setAttribute('aria-label', `减少一份${dish.name}`);
    subtract.disabled = submitting;

    const group = element('div', 'counter-group');
    group.append(subtract, element('span', 'counter-num', quantity), add);
    return group;
}

function updateCart(dish, delta, event) {
    const quantity = (cart.get(dish.id) ?? 0) + delta;
    if (submitting || quantity < 0 || quantity > maxPerDish) return;

    const container = event.currentTarget.closest('.dish-card, .cart-row').parentElement;
    const label = event.currentTarget.getAttribute('aria-label');
    if (quantity) cart.set(dish.id, quantity);
    else cart.delete(dish.id);

    renderCategory();
    renderCart();
    const controls = [...container.querySelectorAll('button:not(:disabled)')];
    const focusTarget = controls.find(node => node.getAttribute('aria-label') === label)
        ?? controls.find(node => node.getAttribute('aria-label') === `增加一份${dish.name}`)
        ?? controls.find(node => node.getAttribute('aria-label') === `减少一份${dish.name}`)
        ?? controls[0]
        ?? (container.id === 'cart-items-container' ? byId('back-to-menu') : document.querySelector('.nav-item.active'));
    focusTarget.focus({ preventScroll: true });
}

function renderCategory() {
    byId('menu-title').textContent = `${categoryLabels[currentCategory]}菜单`;
    const list = byId('full-dish-list');
    list.replaceChildren();
    for (const dish of dishes.filter(item => item.category === currentCategory)) {
        const card = element('article', 'dish-card');
        const link = button('dish-link', undefined, () => openDishDetails(dish));
        link.setAttribute('aria-label', `查看${dish.name}菜谱`);
        const photo = element('img', 'dish-img');
        photo.src = dish.imagePath ?? '/images/kitchen-avatar.jpg';
        photo.alt = '';
        const info = element('span', 'dish-info');
        const price = element('span', 'dish-price', money.format(dish.price));
        price.id = `dish-price-${dish.id}`;
        info.append(element('span', 'dish-name', dish.name), price);
        link.setAttribute('aria-describedby', price.id);
        if (!dish.available) {
            const availability = element('span', 'sold-out', '已售罄');
            availability.id = `dish-availability-${dish.id}`;
            info.append(availability);
            link.setAttribute('aria-describedby', `${price.id} ${availability.id}`);
        }

        link.append(photo, info);
        card.append(link);
        if (dish.available) card.append(quantityControls(dish, cart.get(dish.id) ?? 0));
        list.append(card);
    }
    if (!list.hasChildNodes()) list.textContent = '这个菜系暂时没有菜品。';
}

function openDishDetails(dish) {
    const photo = byId('modal-img');
    photo.src = dish.imagePath ?? '/images/kitchen-avatar.jpg';
    photo.alt = dish.imagePath ? dish.name : '';
    byId('modal-title').textContent = dish.name;
    byId('modal-price').textContent = money.format(dish.price);
    byId('modal-description').textContent = dish.description;

    const recipe = dish.recipe;
    const ingredients = recipe.ingredients.map(ingredient => {
        const row = element('div', 'read-i-row');
        row.append(element('dt', '', ingredient.name), element('dd', 'q-tag', ingredient.amount));
        return row;
    });
    byId('modal-ingredients').replaceChildren(...ingredients);
    byId('modal-steps').replaceChildren(...recipe.steps.map(step => element('li', 'read-s-row', step)));
    byId('modal-tips').textContent = recipe.tips ?? '';
    byId('modal-tips-area').hidden = !recipe.tips;
    dialog.showModal();
    dialog.querySelector('.modal-scroll').scrollTop = 0;
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
    if (!count) list.append(element('p', 'empty', '购物车空空如也。'));
    byId('cart-badge').textContent = count;
    byId('cart-fab').setAttribute('aria-label', `打开购物车（${count} 份）`);
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
    renderCategory();
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
        showNotice(`订单 #${order.id} 已下单 · ${money.format(order.total)}`);
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
        element('h3', '', `订单 #${order.id}`),
        element('span', `status ${order.status.toLowerCase()}`, statusLabels[order.status])
    );
    const list = element('ul', 'receipt-items');
    for (const item of order.items) {
        const line = element('li', 'receipt-line');
        line.append(element('span', '', `${item.quantity} × ${item.name}`),
            element('span', '', `${money.format(item.unitPrice)} / 份`));
        list.append(line);
    }
    const actions = element('div', 'receipt-line');
    actions.append(element('strong', '', `合计 ${money.format(order.total)}`));

    const target = nextStatus[order.status];
    if (target) {
        const change = button('primary-btn', target === 'PREPARING' ? '开始制作' : '标记完成',
            async () => {
                change.disabled = true;
                showNotice();
                try {
                    const updated = await request(`/api/orders/${order.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: target })
                    });
                    showNotice(`订单 #${updated.id} · ${statusLabels[updated.status]}`);
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
    if (!orders.length) list.append(element('p', 'empty', '暂无订单。'));
}

function refreshOrders() {
    renderOrders().catch(error => showNotice(error.message, true));
}

function switchTab(activeView) {
    for (const view of views) view.hidden = view.id !== activeView;
    for (const tab of tabs) {
        const active = tab.dataset.view === activeView;
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
        document.querySelector('.dish-list').scrollTop = 0;
    });
}
for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.view));
byId('cart-fab').addEventListener('click', () => {
    switchTab('view-cart');
    byId('back-to-menu').focus();
});
byId('back-to-menu').addEventListener('click', () => {
    switchTab('view-menu');
    byId('cart-fab').focus();
});
dialog.querySelector('.close-icon').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
});
byId('place-order').addEventListener('click', placeOrder);
byId('refresh-orders').addEventListener('click', refreshOrders);
renderCart();
loadDishesFromServer().catch(error => {
    byId('full-dish-list').textContent = '暂时无法加载菜单。';
    showNotice(error.message, true);
});
