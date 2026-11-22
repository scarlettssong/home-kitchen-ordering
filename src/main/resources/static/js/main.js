const privateMode = document.documentElement.dataset.private === 'true';
const registrationOpen = document.documentElement.dataset.registrationOpen === 'true';
const publicAvatar = document.documentElement.dataset.publicAvatar === 'true';
const language = document.documentElement.lang;
const text = (chinese, english) => language === 'en-US' ? english : chinese;

const byId = id => document.getElementById(id);
const maxPerDish = 3;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const categories = new Map([...document.querySelectorAll('[data-category]')]
    .map(button => [button.dataset.category, button]));
const defaultCategory = categories.keys().next().value;
const tabs = document.querySelectorAll('[data-view]');
const views = [...document.querySelectorAll('main[id]')];
const defaultView = 'view-menu';
const dialog = byId('dish-modal');
const recipeBackdrop = byId('recipe-backdrop');
const orderTime = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
const recipeSplit = matchMedia('(min-width: 850px)');
const mobileLayout = matchMedia('(max-width: 699px)');
const cartButton = byId('cart-button');
const app = byId('app-wrapper');
const cart = new Map();
const dishPhotoVersions = new Map();
const statusLabels = { PLACED: text('已下单', 'Placed'), PREPARING: text('制作中', 'Preparing'), COMPLETED: text('已完成', 'Completed') };
const legacyDemoNames = new Map(Object.entries({
    姜葱香米饭: 'Ginger Scallion Rice',
    芝麻蔬菜煎饺: 'Sesame Garden Dumplings',
    番茄罗勒烤吐司: 'Tomato Basil Toast',
    味噌蘑菇饭团: 'Miso Mushroom Onigiri',
    蜂蜜燕麦布丁: 'Honey Oat Pudding',
    柑橘云朵蛋糕: 'Citrus Cloud Cake'
}));
const nextStatus = { PLACED: 'PREPARING', PREPARING: 'COMPLETED' };

let dishes = [];
let currentCategory = defaultCategory;
let submitting = false;
let session;
let recipeDish;
let recipeMenuPosition;
let desktopBackdropStart = false;
let touchBackdropStart;
let backdropTap = false;
let cartDrag;
let suppressCartClick = false;
let registering = false;
let returnToCart = false;
let toastTimer;

const isAdmin = () => session?.user?.role === 'ADMIN';

function dishPhotoPath(dish) {
    const path = dish?.imagePath;
    const version = dishPhotoVersions.get(dish?.id);
    if (!path || !version) return path;
    return `${path}${path.includes('?') ? '&' : '?'}v=${version}`;
}

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

async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.method && options.method !== 'GET' && session?.csrfToken) {
        headers.set(session.csrfHeader, session.csrfToken);
    }
    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const hints = { 401: text('请检查登录信息或重新登录。', 'Check your credentials or sign in again.'), 403: text('没有权限执行此操作。', 'You do not have permission to do that.'), 413: text('图片不能超过 1 MB。', 'Images must be 1 MB or smaller.') };
        const failure = new Error(hints[response.status] ?? error.detail ?? text('请求失败，请稍后重试。', 'The request failed. Please try again.'));
        failure.status = response.status;
        throw failure;
    }
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : null;
}

function sendJson(path, method, data) {
    return request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

function showNotice(message = '', error = false) {
    if (error) hideToast();
    const notice = byId('notice');
    notice.textContent = message;
    notice.classList.toggle('error', error);
    notice.hidden = !message;
}

function setFormError(id, message = '') {
    const alert = byId(id);
    alert.textContent = message;
    alert.hidden = !message;
}

function hideToast() {
    clearTimeout(toastTimer);
    byId('toast').hidden = true;
}

function showToast(message) {
    showNotice();
    hideToast();
    const toast = byId('toast');
    toast.hidden = false;
    toast.textContent = message;
    toastTimer = setTimeout(hideToast, 2500);
}

function quantityControls(dish, quantity) {
    const add = button(quantity ? 'counter-btn' : 'add-btn', '+', event => updateCart(dish, 1, event));
    add.setAttribute('aria-label', text(`增加一份${dish.name}`, `Add one ${dish.name}`));
    add.disabled = quantity >= maxPerDish || submitting || !dish.available;
    if (!quantity) return add;

    const subtract = button('counter-btn', '−', event => updateCart(dish, -1, event));
    subtract.setAttribute('aria-label', text(`减少一份${dish.name}`, `Remove one ${dish.name}`));
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
        ?? controls.find(node => node.getAttribute('aria-label') === text(`增加一份${dish.name}`, `Add one ${dish.name}`))
        ?? controls.find(node => node.getAttribute('aria-label') === text(`减少一份${dish.name}`, `Remove one ${dish.name}`))
        ?? controls[0]
        ?? (container.id === 'cart-items-container' ? byId('back-to-menu') : [...tabs].find(tab => tab.classList.contains('active') && tab.getClientRects().length));
    focusTarget.focus({ preventScroll: true });
}

function renderCategory() {
    const favorites = new Set(session?.user?.favorites);
    const visible = dishes.filter(dish => dish.category === currentCategory);
    visible.sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
    const list = byId('full-dish-list');
    byId('category-heading').textContent = categories.get(currentCategory).textContent;
    const count = byId('menu-count');
    count.textContent = text(`${visible.length} 道菜品`, `${visible.length} ${visible.length === 1 ? 'dish' : 'dishes'}`);
    count.hidden = false;
    byId('add-dish').hidden = !isAdmin();
    list.replaceChildren();
    for (const dish of visible) {
        const card = element('article', 'dish-card');
        const link = button('dish-link', undefined, () => openDishDetails(dish));
        link.setAttribute('aria-label', text(`查看${dish.name}菜谱`, `View recipe for ${dish.name}`));
        link.dataset.dishId = dish.id;
        const photo = element('img', 'dish-img');
        photo.src = dishPhotoPath(dish) ?? '/images/kitchen-avatar.jpg';
        photo.alt = '';
        const thumbnail = element('span', 'dish-thumbnail');
        thumbnail.append(photo);
        const descriptions = [`dish-price-${dish.id}`];
        if (favorites.has(dish.id)) {
            const heart = element('span', 'dish-favorite', '♥');
            heart.setAttribute('aria-hidden', 'true');
            const label = element('span', 'sr-only', text('已收藏', 'Favorited'));
            label.id = `dish-favorite-${dish.id}`;
            descriptions.push(label.id);
            thumbnail.append(heart, label);
        }
        const info = element('span', 'dish-info');
        info.append(element('span', 'dish-name', dish.name));
        if (dish.description) info.append(element('span', 'dish-description', dish.description));

        const details = element('div', 'dish-meta');
        const price = element('span', 'dish-price', money.format(dish.price));
        price.id = `dish-price-${dish.id}`;
        details.append(price);
        if (dish.available) {
            details.append(quantityControls(dish, cart.get(dish.id) ?? 0));
        } else {
            const availability = element('span', 'sold-out', text('已售罄', 'Sold out'));
            availability.id = `dish-availability-${dish.id}`;
            details.append(availability);
            descriptions.push(availability.id);
        }

        link.setAttribute('aria-describedby', descriptions.join(' '));
        link.append(thumbnail, info);
        card.append(link, details);
        list.append(card);
    }
    if (!visible.length) list.append(element('p', 'empty', text('这个菜系暂时没有菜品。', 'No dishes in this category yet.')));
}

function updateRecipeScrollTarget() {
    byId('recipe-view').tabIndex = recipeSplit.matches ? -1 : 0;
    byId('recipe-content').tabIndex = recipeSplit.matches ? 0 : -1;
}

function openDishDetails(dish) {
    recipeDish = dish;
    recipeMenuPosition = byId('view-menu').hidden ? undefined : {
        category: currentCategory,
        scrollTop: document.querySelector('.menu-scroll').scrollTop
    };
    dialog.classList.add('recipe-mode');
    byId('dish-editor').hidden = true;
    byId('recipe-view').hidden = false;
    dialog.setAttribute('aria-labelledby', 'modal-title');
    renderRecipeActions();
    const photo = byId('modal-img');
    photo.src = dishPhotoPath(dish) ?? '/images/kitchen-avatar.jpg';
    photo.alt = dish.imagePath ? dish.name : '';
    const title = byId('modal-title');
    title.textContent = dish.name;
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
    if (!dialog.open) dialog.showModal();
    updateRecipeScrollTarget();
    byId('recipe-view').scrollTop = 0;
    byId('recipe-content').scrollTop = 0;
    title.focus({ preventScroll: true });
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
    if (!count) list.append(element('p', 'empty', text('购物车空空如也。', 'Your cart is empty.')));
    byId('cart-badge').textContent = count;
    cartButton.setAttribute('aria-label', text(`打开购物车（${count} 份）`, `Open cart (${count} ${count === 1 ? 'item' : 'items'})`));
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
    renderProfile();
}

async function placeOrder() {
    if (submitting || !cart.size) return;
    if (!session?.user) {
        returnToCart = true;
        switchTab('view-profile');
        showNotice(text('请先登录，购物车会保留。', 'Sign in to place your order. Your cart will be saved.'));
        return;
    }
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
        showToast(text(`订单 #${order.id} 已下单 · ${money.format(order.total)}`, `Order #${order.id} placed · ${money.format(order.total)}`));
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
    const time = element('time', 'receipt-time', orderTime.format(new Date(order.createdAt)));
    time.dateTime = order.createdAt;
    heading.append(
        element('h3', '', text(`订单 #${order.id}`, `Order #${order.id}`)),
        time,
        element('span', `status ${order.status.toLowerCase()}`, statusLabels[order.status]),
        element('strong', 'receipt-total', text(`合计 ${money.format(order.total)}`, `Total ${money.format(order.total)}`))
    );
    const list = element('ul', 'receipt-items');
    for (const item of order.items) {
        const line = element('li', 'receipt-line');
        const itemName = text(item.name, legacyDemoNames.get(item.name) ?? item.name);
        line.append(element('span', '', `${item.quantity} × ${itemName}`),
            element('span', '', text(`${money.format(item.unitPrice)} / 份`, `${money.format(item.unitPrice)} each`)));
        list.append(line);
    }
    const target = nextStatus[order.status];
    if (target && isAdmin()) {
        const change = button('primary-btn order-action', target === 'PREPARING' ? text('开始制作', 'Start preparing') : text('标记完成', 'Mark completed'),
            async () => {
                change.disabled = true;
                showNotice();
                try {
                    const updated = await request(`/api/orders/${order.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: target })
                    });
                    showToast(text(`订单 #${updated.id} · ${statusLabels[updated.status]}`, `Order #${updated.id} · ${statusLabels[updated.status]}`));
                    await renderOrders();
                } catch (error) {
                    showNotice(error.message, true);
                    change.disabled = false;
                }
            });
        heading.append(change);
    }

    card.append(heading, list);
    return card;
}

async function renderOrders() {
    const list = byId('order-history-list');
    const viewer = session?.user?.username;
    const orders = await request('/api/orders');
    if (viewer !== session?.user?.username) return;
    list.replaceChildren(...orders.map(orderCard));
    if (!orders.length) list.append(element('p', 'empty', text('暂无订单。', 'No orders yet.')));
}

function refreshOrders() {
    const list = byId('order-history-list');
    list.replaceChildren();
    byId('refresh-orders').hidden = !session?.user;
    byId('view-order').classList.toggle('manager-orders', isAdmin());
    byId('order-title').textContent = isAdmin() ? text('厨房订单', 'Kitchen orders') : text('我的订单', 'My orders');
    if (!session?.user) {
        const prompt = element('div', 'order-login-card');
        prompt.append(
            element('p', '', text('登录后可查看自己的订单。', 'Sign in to view your orders.')),
            button('secondary-btn', text('去登录', 'Sign in'), () => switchTab('view-profile'))
        );
        list.append(prompt);
        return;
    }
    renderOrders().catch(error => showNotice(error.message, true));
}

function readNavigation() {
    try {
        return JSON.parse(sessionStorage.getItem('kitchen-navigation')) ?? {};
    } catch {
        return {};
    }
}

function saveNavigation() {
    try {
        sessionStorage.setItem('kitchen-navigation', JSON.stringify({
            view: app.dataset.activeView,
            category: currentCategory
        }));
    } catch {
        // Navigation still works when browser storage is unavailable.
    }
}

function switchTab(activeView) {
    if (!views.some(view => view.id === activeView)) activeView = defaultView;
    if (privateMode && !session?.user) activeView = 'view-profile';
    app.dataset.activeView = activeView;
    if (activeView === 'view-cart') cartButton.setAttribute('aria-current', 'page');
    else cartButton.removeAttribute('aria-current');
    for (const view of views) view.hidden = view.id !== activeView;
    for (const tab of tabs) {
        const active = tab.dataset.view === activeView;
        tab.classList.toggle('active', active);
        if (active) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    }
    if (activeView === 'view-cart') renderCart();
    if (activeView === 'view-order') refreshOrders();
    if (activeView === 'view-profile') renderProfile();
    saveNavigation();
}

for (const [category, control] of categories) {
    control.addEventListener('click', () => activateCategory(category));
}
for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.view));

cartButton.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressCartClick = false;
    if (!mobileLayout.matches || app.dataset.activeView !== 'view-menu') return;
    const bounds = cartButton.getBoundingClientRect();
    cartDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    cartButton.setPointerCapture(event.pointerId);
});
cartButton.addEventListener('pointermove', event => {
    if (event.pointerId !== cartDrag?.id) return;
    const dx = event.clientX - cartDrag.x;
    const dy = event.clientY - cartDrag.y;
    if (!suppressCartClick && Math.hypot(dx, dy) < 7) return;
    suppressCartClick = true;
    cartButton.style.setProperty('--cart-x', `${cartDrag.left + dx}px`);
    cartButton.style.setProperty('--cart-y', `${cartDrag.top + dy}px`);
    cartButton.classList.add('is-positioned');
});
cartButton.addEventListener('lostpointercapture', event => {
    if (event.pointerId === cartDrag?.id) cartDrag = undefined;
});
cartButton.addEventListener('click', event => {
    if (event.detail !== 0 && suppressCartClick) {
        suppressCartClick = false;
        return;
    }
    switchTab('view-cart');
    byId('back-to-menu').focus();
});
byId('back-to-menu').addEventListener('click', () => {
    switchTab('view-menu');
    cartButton.focus();
});

dialog.querySelector('.close-icon').addEventListener('click', () => dialog.close());
function outside(element, event) {
    const bounds = element.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom;
}

function isNativeBackdrop(event) {
    return event.target === dialog && outside(dialog, event);
}

dialog.addEventListener('pointerdown', event => {
    if (event.isPrimary) desktopBackdropStart = event.button === 0 && isNativeBackdrop(event);
});
dialog.addEventListener('pointercancel', () => { desktopBackdropStart = false; });
dialog.addEventListener('click', event => {
    if (desktopBackdropStart && isNativeBackdrop(event)) dialog.close();
    desktopBackdropStart = false;
});

recipeBackdrop.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    touchBackdropStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    backdropTap = false;
});
recipeBackdrop.addEventListener('pointercancel', () => {
    touchBackdropStart = undefined;
    backdropTap = false;
});
recipeBackdrop.addEventListener('pointerup', event => {
    const start = touchBackdropStart;
    if (event.pointerId !== start?.id) return;
    touchBackdropStart = undefined;
    backdropTap = outside(dialog.querySelector('.dialog-surface'), event) &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10;
});
recipeBackdrop.addEventListener('click', () => {
    if (backdropTap) dialog.close();
    backdropTap = false;
});
byId('place-order').addEventListener('click', placeOrder);

function setRegistrationMode(enabled) {
    registering = enabled;
    setFormError('auth-error');
    byId('register-nickname').hidden = !enabled;
    byId('toggle-register').textContent = enabled ? text('返回登录', 'Back to sign in') : text('新食客注册', 'Create an account');
    byId('auth-submit').textContent = enabled ? text('注册并登录', 'Register and sign in') : text('登录', 'Sign in');
    const password = byId('auth-form').elements.password;
    password.value = '';
    password.autocomplete = enabled ? 'new-password' : 'current-password';
}

async function loadSession() {
    session = await request('/api/session');
    const canBrowse = !privateMode || Boolean(session.user);
    document.documentElement.dataset.canBrowse = String(canBrowse);
    const avatar = byId('kitchen-avatar');
    if (canBrowse) {
        if (!publicAvatar && !session.user) {
            avatar.src = '/images/kitchen-avatar.jpg';
        } else if (!avatar.getAttribute('src')?.startsWith('/api/kitchen/avatar')) {
            refreshAvatar();
        }
    } else {
        avatar.removeAttribute('src');
        dishes = [];
        switchTab('view-profile');
    }
    avatar.hidden = !canBrowse;
    renderCategory();
    renderProfile();
}

function renderProfile() {
    const account = session?.user;
    byId('unlogged-box').hidden = Boolean(account);
    byId('logged-box').hidden = !account;
    if (!account) {
        byId('favorites-list').replaceChildren();
        return;
    }

    byId('profile-nickname').textContent = account.nickname;
    byId('profile-username').textContent = account.username;
    byId('profile-role').textContent = isAdmin() ? text('店长', 'Manager') : text('尊贵食客', 'Guest');
    byId('avatar-settings').hidden = !isAdmin();
    const favorites = dishes.filter(dish => account.favorites.includes(dish.id));
    byId('favorites-list').replaceChildren(...favorites.map(dish => {
        const item = element('li', '');
        item.append(button('secondary-btn', dish.name, () => openDishDetails(dish)));
        return item;
    }));
    if (!favorites.length) byId('favorites-list').append(element('li', 'empty', text('暂无收藏菜品。', 'No favorite dishes yet.')));
}

async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const username = String(fields.get('username')).trim();
    const password = String(fields.get('password'));
    const submit = byId('auth-submit');
    const registration = byId('toggle-register');
    submit.disabled = true;
    registration.disabled = true;
    showNotice();
    setFormError('auth-error');
    try {
        if (!session) await loadSession();
        if (registering) {
            await sendJson('/api/register', 'POST', { username, password, nickname: fields.get('nickname') });
        }
        try {
            await request('/api/login', { method: 'POST', body: new URLSearchParams({ username, password }) });
        } catch (error) {
            if (error.status === 401) throw new Error(text('用户名或密码不正确。', 'Incorrect username or password.'));
            if (error.status === 403) throw new Error(text('登录表单已过期，请刷新页面后重试。', 'The sign-in form expired. Refresh the page and try again.'));
            throw error;
        }
        try {
            await loadSession();
            if (!session.user) throw new Error();
        } catch {
            throw new Error(text('账号验证成功，但未能建立登录会话。请刷新当前页面后重试。', 'Your credentials were verified, but we could not start a session. Refresh and try again.'));
        }
        form.reset();
        if (privateMode) {
            await loadDishesFromServer();
            switchTab('view-menu');
        }
        if (!isAdmin()) showToast(text(`欢迎，${session.user.nickname}。`, `Welcome, ${session.user.nickname}.`));
        if (returnToCart) {
            returnToCart = false;
            switchTab('view-cart');
            byId('place-order').focus();
        }
    } catch (error) {
        setFormError('auth-error', error.message);
    } finally {
        form.elements.password.value = '';
        submit.disabled = false;
        registration.disabled = false;
    }
}

async function logout() {
    try {
        await request('/api/logout', { method: 'POST' });
        hideToast();
        session = null;
        byId('password-form').reset();
        byId('password-error').hidden = true;
        byId('password-settings').open = false;
        setFormError('nickname-error');
        setFormError('avatar-error');
        cart.clear();
        byId('order-history-list').replaceChildren();
        renderCategory();
        renderProfile();
        await loadSession();
        renderCart();
        setRegistrationMode(false);
        showToast(text('已退出登录。', 'Signed out.'));
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function saveNickname(event) {
    event.preventDefault();
    setFormError('nickname-error');
    try {
        const form = event.currentTarget;
        session.user = await sendJson('/api/profile', 'PATCH', { nickname: form.elements.nickname.value });
        form.reset();
        form.closest('details').open = false;
        renderProfile();
        showToast(text('昵称已更新', 'Nickname updated'));
    } catch (error) {
        setFormError('nickname-error', error.message);
    }
}

async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button');
    const alert = byId('password-error');
    alert.hidden = true;
    submit.disabled = true;
    try {
        await sendJson('/api/profile/password', 'PATCH', Object.fromEntries(new FormData(form)));
        form.reset();
        byId('password-settings').open = false;
        showToast(text('密码已更新', 'Password updated'));
    } catch (error) {
        alert.textContent = error.message;
        alert.hidden = false;
        form.elements.currentPassword.value = '';
    } finally {
        submit.disabled = false;
    }
}

function renderRecipeActions() {
    const favorite = byId('favorite-dish');
    const selected = session?.user?.favorites.includes(recipeDish.id);
    favorite.hidden = !session?.user;
    favorite.textContent = selected ? text('♥ 已收藏', '♥ Favorited') : text('♡ 收藏', '♡ Add to favorites');
    favorite.setAttribute('aria-pressed', String(Boolean(selected)));
    byId('edit-dish').hidden = !isAdmin();
}

async function toggleFavorite() {
    const account = session?.user;
    if (!account) return;
    const dishId = recipeDish.id;
    const control = byId('favorite-dish');
    const selected = account.favorites.includes(dishId);
    control.disabled = true;
    try {
        await request(`/api/favorites/${dishId}`, { method: selected ? 'DELETE' : 'PUT' });
        if (session?.user !== account) return;
        account.favorites = selected
            ? account.favorites.filter(id => id !== dishId)
            : [...account.favorites, dishId];
        renderCategory();
        renderProfile();
        if (dialog.open && recipeDish.id === dishId) renderRecipeActions();
    } catch (error) {
        showNotice(error.message, true);
    } finally {
        control.disabled = false;
    }
}

function refreshAvatar() {
    byId('kitchen-avatar').src = `/api/kitchen/avatar?v=${Date.now()}`;
}

async function saveAvatar(event) {
    event.preventDefault();
    setFormError('avatar-error');
    const form = event.currentTarget;
    const image = form.elements.image.files[0];
    try {
        validatePhoto(image);
        await request('/api/admin/avatar', { method: 'PUT', body: new FormData(form) });
        form.reset();
        refreshAvatar();
        showToast(text('厨房头像已更新。', 'Kitchen avatar updated.'));
    } catch (error) {
        setFormError('avatar-error', error.message);
    }
}

async function resetAvatar() {
    setFormError('avatar-error');
    try {
        await request('/api/admin/avatar', { method: 'DELETE' });
        refreshAvatar();
        showToast(text('已恢复默认头像。', 'Default avatar restored.'));
    } catch (error) {
        setFormError('avatar-error', error.message);
    }
}

const editor = byId('dish-editor');
const dishSaveButton = byId('save-dish');
const maxImageBytes = 1024 * 1024;
const maxImageSide = 4096;
let editingId;
let removePhoto = false;
let previewUrl;
let selectedPhoto;
let photoSelection = 0;
let preparingPhoto = false;
let savingDish = false;

function setPreparingPhoto(preparing, compressing = false) {
    preparingPhoto = preparing;
    byId('photo-status').hidden = !compressing;
    dishSaveButton.disabled = preparingPhoto || savingDish;
}

function resetPhotoSelection() {
    photoSelection++;
    selectedPhoto = undefined;
    clearPreviewUrl();
    setPreparingPhoto(false);
}

function editorError(message = '') {
    const error = byId('editor-error');
    error.textContent = message;
    error.hidden = !message;
    if (message) editor.querySelector('.editor-scroll').scrollTop = 0;
}

function showPhotoPreview(url) {
    const photo = byId('editor-photo');
    if (url) photo.src = url;
    else photo.removeAttribute('src');
    photo.hidden = !url;
    byId('remove-photo').hidden = !url;
}

function clearPreviewUrl() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
}

function openEditor(dish) {
    editingId = dish?.id;
    dialog.classList.remove('recipe-mode');
    removePhoto = false;
    resetPhotoSelection();
    editor.reset();
    editorError();
    editor.elements.name.value = dish?.name ?? '';
    editor.elements.category.value = dish?.category ?? currentCategory;
    editor.elements.price.value = dish?.price ?? '';
    editor.elements.description.value = dish?.description ?? '';
    editor.elements.available.checked = dish?.available ?? true;
    editor.elements.tips.value = dish?.recipe.tips ?? '';
    showPhotoPreview(dishPhotoPath(dish));

    byId('editable-ingredients').replaceChildren();
    byId('editable-steps').replaceChildren();
    for (const ingredient of dish?.recipe.ingredients ?? []) addIngredient(ingredient);
    for (const step of dish?.recipe.steps ?? []) addStep(step);
    byId('editor-title').textContent = dish ? text('编辑菜谱', 'Edit recipe') : text('添加新菜品', 'Add dish');
    byId('delete-dish').hidden = !dish;
    byId('recipe-view').hidden = true;
    editor.hidden = false;
    dialog.setAttribute('aria-labelledby', 'editor-title');
    if (!dialog.open) dialog.showModal();
    editor.querySelector('.editor-scroll').scrollTop = 0;
    editor.elements.name.focus();
}

function textField(label, value, maxLength) {
    const input = element('input', '');
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    input.maxLength = maxLength;
    input.value = value;
    return input;
}

function addIngredient(ingredient = { name: '', amount: '' }) {
    const row = element('div', 'ingredient-edit');
    const name = textField(text('原料名称', 'Ingredient name'), ingredient.name, 120);
    const amount = textField(text('用量', 'Amount'), ingredient.amount, 80);
    row.append(name, amount, button('secondary-btn row-remove', text('移除', 'Remove'), () => row.remove()));
    byId('editable-ingredients').append(row);
    return name;
}

function addStep(step = '') {
    const item = element('li', 'step-edit');
    const row = element('div', 'step-fields');
    const input = element('textarea', '');
    input.setAttribute('aria-label', text('步骤内容', 'Step instructions'));
    input.placeholder = text('步骤内容', 'Step instructions');
    input.maxLength = 2000;
    input.rows = 2;
    input.value = step;
    row.append(input, button('secondary-btn row-remove', text('移除', 'Remove'), () => item.remove()));
    item.append(row);
    byId('editable-steps').append(item);
    return input;
}

function validatePhotoType(photo) {
    if (!['image/jpeg', 'image/png'].includes(photo.type)) {
        throw new Error(text('请选择 JPEG 或 PNG 图片。', 'Choose a JPEG or PNG image.'));
    }
}

function validatePhoto(photo) {
    if (photo.size > maxImageBytes) {
        throw new Error(text('图片不能超过 1 MB。', 'Images must be 1 MB or smaller.'));
    }
    validatePhotoType(photo);
}

async function prepareDishPhoto(file) {
    validatePhotoType(file);
    let image;
    try {
        image = await createImageBitmap(file);
    } catch {
        throw new Error(text('无法读取这张图片，请选择可正常打开的 JPEG 或 PNG 图片。',
            'Could not read this image. Choose a JPEG or PNG that opens normally.'));
    }

    try {
        const longSide = Math.max(image.width, image.height);
        if (file.size <= maxImageBytes) {
            if (longSide > maxImageSide) {
                throw new Error(text('图片长宽不能超过 4096 像素。', 'Image dimensions must be at most 4096 pixels.'));
            }
            return file;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const qualities = file.type === 'image/jpeg' ? [0.92, 0.82, 0.72] : [undefined];
        let targetSide = Math.min(longSide, maxImageSide);
        const minSide = Math.min(targetSide, 320);
        try {
            while (context) {
                const scale = targetSide / longSide;
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                context.imageSmoothingQuality = 'high';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);

                let lastSize = 0;
                for (const quality of qualities) {
                    const compressed = await new Promise(resolve => canvas.toBlob(resolve, file.type, quality));
                    if (!compressed || compressed.type !== file.type) break;
                    if (compressed.size <= maxImageBytes) {
                        return new File([compressed], file.name, { type: file.type });
                    }
                    lastSize = compressed.size;
                }
                if (!lastSize || targetSide === minSide) break;

                const shrink = Math.max(0.5, Math.min(0.88, 0.94 * Math.sqrt(maxImageBytes / lastSize)));
                targetSide = Math.max(minSide, Math.floor(targetSide * shrink));
            }
        } catch {
            // Canvas encoding can fail on devices with limited image memory.
        } finally {
            canvas.width = canvas.height = 0;
        }
        throw new Error(text('无法将这张图片压缩到 1 MB 以内，请选择较小的 JPEG 或 PNG 图片。',
            'Could not compress this image to 1 MB. Choose a smaller JPEG or PNG.'));
    } finally {
        image.close();
    }
}

async function selectDishPhoto(event) {
    const field = event.currentTarget;
    const file = field.files[0];
    if (!file) return;
    const selection = ++photoSelection;
    editorError();
    setPreparingPhoto(true, file.size > maxImageBytes);
    try {
        const photo = await prepareDishPhoto(file);
        if (selection !== photoSelection || !dialog.open) return;
        const url = URL.createObjectURL(photo);
        clearPreviewUrl();
        previewUrl = url;
        selectedPhoto = photo;
        showPhotoPreview(previewUrl);
        removePhoto = false;
    } catch (error) {
        if (selection !== photoSelection || !dialog.open) return;
        field.value = '';
        editorError(error.message);
    } finally {
        if (selection === photoSelection) setPreparingPhoto(false);
    }
}

async function saveDish(event) {
    event.preventDefault();
    if (preparingPhoto || savingDish) return;
    editorError();
    const fields = editor.elements;
    const ingredients = [...byId('editable-ingredients').children].map(row => {
        const [name, amount] = row.querySelectorAll('input');
        return { name: name.value.trim(), amount: amount.value.trim() };
    });
    if (ingredients.some(item => item.amount && !item.name)) {
        editorError(text('请填写有用量的原料名称。', 'Enter a name for each ingredient with an amount.'));
        return;
    }
    const steps = [...byId('editable-steps').querySelectorAll('textarea')]
        .map(input => input.value.trim()).filter(Boolean);
    const data = {
        name: fields.name.value.trim(), category: fields.category.value, price: Number(fields.price.value),
        description: fields.description.value.trim(), available: fields.available.checked,
        ingredients: ingredients.filter(item => item.name), steps, tips: fields.tips.value.trim(),
        removeImage: removePhoto
    };
    if (!data.name) {
        editorError(text('请输入菜名。', 'Enter a dish name.'));
        return;
    }
    const payload = new FormData();
    payload.append('dish', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const replacingPhoto = Boolean(selectedPhoto);
    if (replacingPhoto) payload.append('image', selectedPhoto);

    savingDish = true;
    dishSaveButton.disabled = true;
    try {
        const saved = await request(editingId ? `/api/admin/dishes/${editingId}` : '/api/admin/dishes', {
            method: editingId ? 'PUT' : 'POST', body: payload
        });
        if (replacingPhoto) dishPhotoVersions.set(saved.id, Date.now());
        dialog.close();
        activateCategory(data.category);
        await loadDishesFromServer();
        showToast(text('菜品已保存。', 'Dish saved.'));
    } catch (error) {
        if (dialog.open) editorError(error.message);
        else showNotice(error.message, true);
    } finally {
        savingDish = false;
        dishSaveButton.disabled = preparingPhoto;
    }
}

async function deleteDish() {
    if (!window.confirm(text('删除这道菜？已下单的订单会保留原菜名与价格。', 'Delete this dish? Existing orders will keep its original name and price.'))) return;
    try {
        await request(`/api/admin/dishes/${editingId}`, { method: 'DELETE' });
        dishPhotoVersions.delete(editingId);
        dialog.close();
        await loadDishesFromServer();
        showToast(text('菜品已删除。', 'Dish deleted.'));
    } catch (error) {
        if (dialog.open) editorError(error.message);
        else showNotice(error.message, true);
    }
}

function activateCategory(category) {
    currentCategory = categories.has(category) ? category : defaultCategory;
    for (const [value, item] of categories) {
        const active = value === currentCategory;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
    }
    renderCategory();
    document.querySelector('.menu-scroll').scrollTop = 0;
    saveNavigation();
}

byId('refresh-orders').addEventListener('click', refreshOrders);
byId('toggle-register').addEventListener('click', () => setRegistrationMode(registrationOpen && !registering));
byId('auth-form').addEventListener('submit', submitAuth);
byId('logout').addEventListener('click', logout);
byId('nickname-form').addEventListener('submit', saveNickname);
byId('password-settings').hidden = document.documentElement.dataset.passwordChanges !== 'true';
byId('password-form').addEventListener('submit', changePassword);
byId('favorite-dish').addEventListener('click', toggleFavorite);
byId('avatar-form').addEventListener('submit', saveAvatar);
byId('reset-avatar').addEventListener('click', resetAvatar);
byId('add-dish').addEventListener('click', () => openEditor());
recipeSplit.addEventListener('change', updateRecipeScrollTarget);
byId('edit-dish').addEventListener('click', () => openEditor(recipeDish));
byId('add-ingredient').addEventListener('click', () => addIngredient().focus());
byId('add-step').addEventListener('click', () => addStep().focus());
editor.elements.photo.addEventListener('change', selectDishPhoto);
byId('remove-photo').addEventListener('click', () => {
    editor.elements.photo.value = '';
    resetPhotoSelection();
    removePhoto = true;
    showPhotoPreview(null);
});
byId('delete-dish').addEventListener('click', deleteDish);
editor.addEventListener('submit', saveDish);
dialog.addEventListener('close', () => {
    resetPhotoSelection();
    desktopBackdropStart = false;
    touchBackdropStart = undefined;
    backdropTap = false;
    if (dialog.classList.contains('recipe-mode') && recipeMenuPosition?.category === currentCategory &&
            !byId('view-menu').hidden) {
        const scroller = document.querySelector('.menu-scroll');
        scroller.querySelector(`[data-dish-id="${recipeDish.id}"]`)?.focus({ preventScroll: true });
        scroller.scrollTop = recipeMenuPosition.scrollTop;
    }
    recipeMenuPosition = undefined;
});

byId('toggle-register').hidden = !registrationOpen;
const savedNavigation = readNavigation();
loadSession().catch(error => showNotice(error.message, true)).then(() => {
    activateCategory(savedNavigation.category);
    switchTab(savedNavigation.view);
    if (!privateMode || session?.user) return loadDishesFromServer();
}).catch(error => showNotice(error.message, true));
