# Plantillas de correo de Supabase Auth — tema "Cuaderno"

Supabase envía los correos de **confirmación de cuenta**, **magic link** y
**recuperar contraseña** con SUS plantillas (no pasan por Resend). Para
brandearlos: **Dashboard → Authentication → Emails → Templates**, pega el HTML
de cada uno y guarda. Variables como `{{ .ConfirmationURL }}` las rellena
Supabase.

> Sender: en Authentication → Emails → SMTP Settings puedes apuntar el SMTP a
> Resend (smtp.resend.com, usuario `resend`, password = API key) para que
> salgan desde `Aulia <hola@mail.aulia.ai>` con tu dominio verificado.

## 1. Confirm signup (confirmación de cuenta)

Asunto sugerido: `Confirma tu cuenta — tu primera ruta te espera ✺`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1E8D3;padding:24px 12px;font-family:'Nunito Sans','Segoe UI',Arial,sans-serif">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td align="center" style="padding-bottom:18px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:#0E5340;border-radius:18px;width:56px;height:56px;text-align:center;vertical-align:middle">
            <span style="display:inline-block;width:7px;height:16px;border-radius:4px;background:#FAF6EE;margin:0 2px;vertical-align:middle"></span><span style="display:inline-block;width:7px;height:30px;border-radius:4px;background:#F2A65A;margin:0 2px;vertical-align:middle"></span><span style="display:inline-block;width:7px;height:22px;border-radius:4px;background:#FAF6EE;margin:0 2px;vertical-align:middle"></span><span style="display:inline-block;width:7px;height:11px;border-radius:4px;background:#FAF6EE;margin:0 2px;vertical-align:middle"></span>
          </td>
          <td style="padding-left:12px;font-size:26px;font-weight:700;color:#0E5340;letter-spacing:-0.5px">Aulia</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#FCF9F0;border:1px solid #DBCFB3;border-radius:16px;padding:32px 28px">
        <span style="display:inline-block;background:#FCE15C;color:#5A4A05;border-radius:6px;padding:4px 14px;font-size:13px;font-weight:800;margin-bottom:14px">✺ Bienvenido/a</span>
        <h1 style="color:#23273A;font-size:24px;line-height:30px;margin:0 0 10px;font-weight:800">Confirma tu cuenta y empieza a aprender</h1>
        <p style="color:#565C71;font-size:15px;line-height:23px;margin:0 0 22px">Un clic y entras a Aulia: dinos qué quieres lograr y la IA te arma tu <b style="color:#23273A">ruta de aprendizaje a medida</b> — con tu propio profesor particular de IA en vivo.</p>
        <a href="{{ .ConfirmationURL }}" style="background:#0E5340;color:#fff;border-radius:999px;padding:12px 26px;font-size:15px;font-weight:800;text-decoration:none;display:inline-block">Confirmar mi cuenta</a>
        <p style="color:#8C8D9A;font-size:12px;line-height:18px;margin:18px 0 0">Si no creaste esta cuenta, ignora este correo.</p>
      </td></tr>
      <tr><td align="center" style="padding-top:14px;color:#565C71;font-size:12px">De querer aprenderlo a <span style="background:#FCE15C;padding:0 3px;border-radius:2px;color:#23273A;font-weight:700">saberlo</span>. · aulia.ai</td></tr>
    </table>
  </td></tr>
</table>
```

## 2. Magic Link

Mismo HTML; cambia el badge a `✺ Tu acceso`, el h1 a
`Tu enlace mágico para entrar`, el párrafo a
`Un clic y estás dentro — sin contraseñas.` y el botón a
`Entrar a Aulia` con `{{ .ConfirmationURL }}`.

## 3. Reset password

Badge `✺ Recuperar acceso`, h1 `Crea una contraseña nueva`, botón
`Crear contraseña nueva` con `{{ .ConfirmationURL }}`.
