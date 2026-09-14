<script setup>
import { onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SessionRecovery from '../components/SessionRecovery.vue';
import { registerAccount } from '../api/auth.js';
import { useAuthStore } from '../stores/auth.js';
import { fieldErrorsFrom, requestMessage, safeReturnPath, validateRegistration } from '../utils/auth.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const form = reactive({ username: '', email: '', password: '', confirmPassword: '' });
const errors = ref({});
const errorMessage = ref('');
const submitting = ref(false);
let active = true;
onUnmounted(() => { active = false; });

async function submit() {
  if (submitting.value) return;
  errors.value = validateRegistration(form);
  errorMessage.value = '';
  if (Object.keys(errors.value).length) return;
  submitting.value = true;
  const revision = auth.revision;
  const returnPath = safeReturnPath(route.query.returnTo);
  try {
    await registerAccount({ username: form.username.trim(), email: form.email.trim().toLowerCase(), password: form.password });
    form.password = '';
    form.confirmPassword = '';
    if (!active || auth.revision !== revision) return;
    auth.notice = '注册成功，请使用新账号登录';
    await router.replace({ path: '/login', query: { returnTo: returnPath } });
  } catch (error) {
    if (!active) return;
    errors.value = fieldErrorsFrom(error);
    errorMessage.value = requestMessage(error, '注册失败，请检查输入内容');
  } finally { submitting.value = false; }
}
</script>

<template>
  <section class="catalog-panel auth-panel" aria-labelledby="register-heading">
    <h1 id="register-heading">注册账号</h1>
    <SessionRecovery v-if="auth.token && !auth.isAuthenticated" />
    <form v-else class="auth-form" novalidate @submit.prevent="submit">
      <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>
      <div class="auth-field">
        <label for="register-username">用户名</label>
        <input id="register-username" v-model="form.username" autocomplete="username" required :disabled="submitting" :aria-invalid="Boolean(errors.username)" aria-describedby="username-help username-error">
        <p id="username-help" class="auth-help">2–20 个字符，不能包含空白或 @。</p>
        <p v-if="errors.username" id="username-error" class="auth-error">{{ errors.username }}</p>
      </div>
      <div class="auth-field">
        <label for="register-email">邮箱</label>
        <input id="register-email" v-model="form.email" type="email" autocomplete="email" required :disabled="submitting" :aria-invalid="Boolean(errors.email)" :aria-describedby="errors.email ? 'email-error' : undefined">
        <p v-if="errors.email" id="email-error" class="auth-error">{{ errors.email }}</p>
      </div>
      <div class="auth-field">
        <label for="register-password">密码</label>
        <input id="register-password" v-model="form.password" type="password" autocomplete="new-password" required :disabled="submitting" :aria-invalid="Boolean(errors.password)" aria-describedby="password-help password-error">
        <p id="password-help" class="auth-help">至少 8 个字符，最多 72 个 UTF-8 字节；中文和表情占用多个字节。</p>
        <p v-if="errors.password" id="password-error" class="auth-error">{{ errors.password }}</p>
      </div>
      <div class="auth-field">
        <label for="register-confirm">确认密码</label>
        <input id="register-confirm" v-model="form.confirmPassword" type="password" autocomplete="new-password" required :disabled="submitting" :aria-invalid="Boolean(errors.confirmPassword)" :aria-describedby="errors.confirmPassword ? 'confirm-error' : undefined">
        <p v-if="errors.confirmPassword" id="confirm-error" class="auth-error">{{ errors.confirmPassword }}</p>
      </div>
      <button class="auth-submit" type="submit" :disabled="submitting">{{ submitting ? '正在注册…' : '注册' }}</button>
      <p class="auth-form-footer">已有账号？<RouterLink :to="{ path: '/login', query: { returnTo: safeReturnPath(route.query.returnTo) } }">登录</RouterLink></p>
    </form>
  </section>
</template>
