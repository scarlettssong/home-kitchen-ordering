const privateMode = document.documentElement.dataset.private === 'true';
const language = document.documentElement.lang;
const text = (chinese, english) => language === 'en-US' ? english : chinese;

const byId = id => document.getElementById(id);
const maxPerDish = 3;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const categories = document.querySelectorAll('[data-category]');
const tabs = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('main[id]');
const dialog = byId('dish-modal');
const orderTime = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
const recipeSplit = matchMedia('(min-width: 850px)');
const cart = new Map();
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
let currentCategory = 'All';
let submitting = false;
let session;
let recipeDish;
let recipeMenuPosition;
let pointerStartedOnBackdrop = false;
let registering = false;
let returnToCart = false;
let toastTimer;

const isAdmin = () => session?.user?.role === 'ADMIN';

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

function hideToast() {
    clearTimeout(toastTimer);
    byId('toast').hidden = true;
}

function showToast(message) {
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
    const visible = dishes.filter(dish => currentCategory === 'All' || dish.category === currentCategory);
    visible.sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
    const list = byId('full-dish-list');
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
        photo.src = dish.imagePath ?? '/images/kitchen-avatar.jpg';
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
    if (!dialog.open) dialog.showModal();
    updateRecipeScrollTarget();
    byId('recipe-view').scrollTop = 0;
    byId('recipe-content').scrollTop = 0;
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
    byId('cart-button').setAttribute('aria-label', text(`打开购物车（${count} 份）`, `Open cart (${count} ${count === 1 ? 'item' : 'items'})`));
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
                    showNotice(text(`订单 #${updated.id} · ${statusLabels[updated.status]}`, `Order #${updated.id} · ${statusLabels[updated.status]}`));
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
        list.append(element('p', 'empty', text('登录后可查看自己的订单。', 'Sign in to view your orders.')));
        list.append(button('secondary-btn', text('前往登录', 'Sign in'), () => switchTab('view-profile')));
        return;
    }
    renderOrders().catch(error => showNotice(error.message, true));
}

function switchTab(activeView) {
    if (privateMode && !session?.user) activeView = 'view-profile';
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
}

for (const category of categories) {
    category.setAttribute('aria-pressed', String(category.classList.contains('active')));
    category.addEventListener('click', () => activateCategory(category.dataset.category));
}
for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.view));
byId('cart-button').addEventListener('click', () => {
    switchTab('view-cart');
    byId('back-to-menu').focus();
});
byId('back-to-menu').addEventListener('click', () => {
    switchTab('view-menu');
    byId('cart-button').focus();
});
dialog.querySelector('.close-icon').addEventListener('click', () => dialog.close());
function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom;
}

dialog.addEventListener('pointerdown', event => {
    pointerStartedOnBackdrop = event.isPrimary && event.button === 0 && isBackdrop(event);
});
dialog.addEventListener('pointercancel', () => { pointerStartedOnBackdrop = false; });
dialog.addEventListener('click', event => {
    if (pointerStartedOnBackdrop && isBackdrop(event)) dialog.close();
    pointerStartedOnBackdrop = false;
});
byId('place-order').addEventListener('click', placeOrder);

function setRegistrationMode(enabled) {
    registering = enabled;
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
        if (!avatar.hasAttribute('src')) refreshAvatar();
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
        showNotice(error.message, true);
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
        cart.clear();
        byId('order-history-list').replaceChildren();
        renderCategory();
        renderProfile();
        await loadSession();
        renderCart();
        setRegistrationMode(false);
        showNotice(text('已退出登录。', 'Signed out.'));
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function saveNickname(event) {
    event.preventDefault();
    try {
        const form = event.currentTarget;
        session.user = await sendJson('/api/profile', 'PATCH', { nickname: form.elements.nickname.value });
        form.reset();
        form.closest('details').open = false;
        renderProfile();
        showNotice(text('已保存昵称。', 'Nickname saved.'));
    } catch (error) {
        showNotice(error.message, true);
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
    const form = event.currentTarget;
    const image = form.elements.image.files[0];
    try {
        validatePhoto(image);
        await request('/api/admin/avatar', { method: 'PUT', body: new FormData(form) });
        form.reset();
        refreshAvatar();
        showNotice(text('厨房头像已更新。', 'Kitchen avatar updated.'));
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function resetAvatar() {
    try {
        await request('/api/admin/avatar', { method: 'DELETE' });
        refreshAvatar();
        showNotice(text('已恢复默认头像。', 'Default avatar restored.'));
    } catch (error) {
        showNotice(error.message, true);
    }
}

const editor = byId('dish-editor');
let editingId;
let removePhoto = false;
let previewUrl;

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
    clearPreviewUrl();
    editor.reset();
    editorError();
    editor.elements.name.value = dish?.name ?? '';
    editor.elements.category.value = dish?.category ?? (currentCategory === 'All' ? 'Chinese' : currentCategory);
    editor.elements.price.value = dish?.price ?? '';
    editor.elements.description.value = dish?.description ?? '';
    editor.elements.available.checked = dish?.available ?? true;
    editor.elements.tips.value = dish?.recipe.tips ?? '';
    showPhotoPreview(dish?.imagePath);

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

function validatePhoto(photo) {
    if (photo.size > 1024 * 1024) throw new Error(text('图片不能超过 1 MB。', 'Images must be 1 MB or smaller.'));
    if (!['image/jpeg', 'image/png'].includes(photo.type)) throw new Error(text('请选择 JPEG 或 PNG 图片。', 'Choose a JPEG or PNG image.'));
}

function selectDishPhoto(event) {
    const field = event.currentTarget;
    if (!field.files.length) return;
    try {
        validatePhoto(field.files[0]);
        clearPreviewUrl();
        previewUrl = URL.createObjectURL(field.files[0]);
        showPhotoPreview(previewUrl);
        removePhoto = false;
        editorError();
    } catch (error) {
        field.value = '';
        clearPreviewUrl();
        showPhotoPreview(removePhoto ? null : dishes.find(dish => dish.id === editingId)?.imagePath);
        editorError(error.message);
    }
}

async function saveDish(event) {
    event.preventDefault();
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
    if (fields.photo.files.length) payload.append('image', fields.photo.files[0]);

    const save = editor.querySelector('button[type="submit"], .editor-footer .primary-btn');
    save.disabled = true;
    try {
        await request(editingId ? `/api/admin/dishes/${editingId}` : '/api/admin/dishes', {
            method: editingId ? 'PUT' : 'POST', body: payload
        });
        dialog.close();
        activateCategory(data.category);
        await loadDishesFromServer();
        showNotice(text('菜品已保存。', 'Dish saved.'));
    } catch (error) {
        if (dialog.open) editorError(error.message);
        else showNotice(error.message, true);
    } finally {
        save.disabled = false;
    }
}

async function deleteDish() {
    if (!window.confirm(text('删除这道菜？已下单的订单会保留原菜名与价格。', 'Delete this dish? Existing orders will keep its original name and price.'))) return;
    try {
        await request(`/api/admin/dishes/${editingId}`, { method: 'DELETE' });
        dialog.close();
        await loadDishesFromServer();
        showNotice(text('菜品已删除。', 'Dish deleted.'));
    } catch (error) {
        if (dialog.open) editorError(error.message);
        else showNotice(error.message, true);
    }
}

function activateCategory(category) {
    currentCategory = category;
    for (const item of categories) {
        const active = item.dataset.category === category;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
    }
    renderCategory();
    document.querySelector('.menu-scroll').scrollTop = 0;
}

byId('refresh-orders').addEventListener('click', refreshOrders);
byId('toggle-register').addEventListener('click', () => setRegistrationMode(!privateMode && !registering));
byId('auth-form').addEventListener('submit', submitAuth);
byId('logout').addEventListener('click', logout);
byId('nickname-form').addEventListener('submit', saveNickname);
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
    clearPreviewUrl();
    removePhoto = true;
    showPhotoPreview(null);
});
byId('delete-dish').addEventListener('click', deleteDish);
editor.addEventListener('submit', saveDish);
dialog.addEventListener('close', () => {
    clearPreviewUrl();
    pointerStartedOnBackdrop = false;
    if (dialog.classList.contains('recipe-mode') && recipeMenuPosition?.category === currentCategory &&
            !byId('view-menu').hidden) {
        const scroller = document.querySelector('.menu-scroll');
        scroller.querySelector(`[data-dish-id="${recipeDish.id}"]`)?.focus({ preventScroll: true });
        scroller.scrollTop = recipeMenuPosition.scrollTop;
    }
    recipeMenuPosition = undefined;
});

byId('toggle-register').hidden = privateMode;
if (privateMode) switchTab('view-profile');
renderCart();
loadSession().then(() => {
    if (!privateMode || session.user) {
        if (privateMode) switchTab('view-menu');
        return loadDishesFromServer();
    }
}).catch(error => showNotice(error.message, true));
