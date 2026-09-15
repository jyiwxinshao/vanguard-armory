<script setup>
import { onUnmounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import SessionRecovery from '../components/SessionRecovery.vue';
import { useAuthStore } from '../stores/auth.js';
import { fieldErrorsFrom, requestMessage, safeReturnPath, validateLogin } from '../utils/auth.js';

const route = useRoute();
const auth = useAuthStore();
const form = reactive({ account: '', password: '' });
const errors = ref({});
const errorMessage = ref('');
const submitting = ref(false);
let active = true;
onUnmounted(() => { active = false; });

async function submit() {
  if (submitting.value) return;
  errors.value = validateLogin(form);
  errorMessage.value = '';
  if (Object.keys(errors.value).length) return;
  submitting.value = true;
  try {
    await auth.login({ account: form.account.trim(), password: form.password });
    form.password = '';
    // main.js owns the authenticated redirect; cart initialization is app-scoped.
  } catch (error) {
    if (!active) return;
    errors.value = fieldErrorsFrom(error);
    errorMessage.value = requestMessage(error, '登录失败，请检查用户名和密码');
  } finally { submitting.value = false; }
}
</script>

<template>
  <section class="catalog-panel auth-panel" aria-labelledby="login-heading">
    <h1 id="login-heading">登录</h1>
    <SessionRecovery v-if="auth.token && !auth.isAuthenticated" />
    <form v-else class="auth-form" novalidate @submit.prevent="submit">
      <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>
      <div class="auth-field">
        <label for="login-account">用户名或邮箱</label>
        <input id="login-account" v-model="form.account" autocomplete="username" required :disabled="submitting" :aria-invalid="Boolean(errors.account)" :aria-describedby="errors.account ? 'login-account-error' : undefined">
        <p v-if="errors.account" id="login-account-error" class="auth-error">{{ errors.account }}</p>
      </div>
      <div class="auth-field">
        <label for="login-password">密码</label>
        <input id="login-password" v-model="form.password" type="password" autocomplete="current-password" required :disabled="submitting" :aria-invalid="Boolean(errors.password)" :aria-describedby="errors.password ? 'login-password-error' : undefined">
        <p v-if="errors.password" id="login-password-error" class="auth-error">{{ errors.password }}</p>
      </div>
      <button class="auth-submit" type="submit" :disabled="submitting">{{ submitting ? '正在登录…' : '登录' }}</button>
      <p class="auth-form-footer">还没有账号？<RouterLink :to="{ path: '/register', query: { returnTo: safeReturnPath(route.query.returnTo) } }">注册账号</RouterLink></p>
    </form>
  </section>
</template>
