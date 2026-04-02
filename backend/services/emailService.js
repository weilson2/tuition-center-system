const nodemailer = require('nodemailer');

// Create email transporter
const createTransporter = () => {
  // For Gmail or Google Workspace emails
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Your email
      pass: process.env.EMAIL_PASSWORD // Your app password
    }
  });
};

// Send password reset email
async function sendPasswordResetEmail(to, resetToken, userFullName) {
  try {
    const transporter = createTransporter();

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"Tuition Center" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: '🔐 Password Reset Request - Tuition Center',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="x-apple-disable-message-reformatting">
          <style>
            /* RESET STYLES */
            html, body {
              margin: 0 auto !important;
              padding: 0 !important;
              height: 100% !important;
              width: 100% !important;
              background-color: #f4f7fa;
            }
            * {
              -ms-text-size-adjust: 100%;
              -webkit-text-size-adjust: 100%;
            }
            div[style*="margin: 16px 0"] {
              margin: 0 !important;
            }
            table, td {
              mso-table-lspace: 0pt !important;
              mso-table-rspace: 0pt !important;
            }
            table {
              border-spacing: 0 !important;
              border-collapse: collapse !important;
              table-layout: fixed !important;
              margin: 0 auto !important;
            }
            img {
              -ms-interpolation-mode: bicubic;
            }
            a {
              text-decoration: none;
            }

            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', Helvetica, Arial, sans-serif;
              line-height: 1.6;
              color: #374151;
              max-width: 600px;
              margin: 40px auto;
              padding: 0;
              background-color: #ffffff;
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            }
            .header {
              background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
              color: white;
              padding: 40px 20px;
              text-align: center;
              border-radius: 0;
            }
            .header h1 {
              margin: 0;
              font-size: 26px;
              font-weight: 700;
              letter-spacing: -0.5px;
            }
            .content {
              background: #ffffff;
              padding: 40px;
              border-radius: 0;
            }
            .button {
              display: inline-block;
              background-color: #2563eb;
              color: #ffffff !important;
              padding: 16px 36px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              font-size: 16px;
              margin: 20px 0;
              border: none;
              box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
              transition: background-color 0.2s;
            }
            .button:hover {
              background-color: #1d4ed8;
              color: #ffffff;
            }

            .info-box {
              background-color: #eff6ff;
              border-left: 4px solid #3b82f6;
              padding: 20px;
              margin: 25px 0;
              border-radius: 10px;
            }
            .info-box strong {
              font-weight: 700;
              font-size: 14px;
              color: #1e40af;
              display: block;
              margin-bottom: 4px;
            }
            .info-box p {
              font-size: 13px;
              color: #1d4ed8;
            }
            .warning-box {
              background-color: #fffbeb;
              border-left: 4px solid #f59e0b;
              padding: 20px;
              margin: 25px 0;
              border-radius: 10px;
            }
            .warning-box strong {
              font-weight: 700;
              font-size: 14px;
              color: #92400e;
              display: block;
              margin-bottom: 4px;
            }
            .warning-box p {
              font-size: 13px;
              color: #b45309;
            }
            .footer {
              text-align: center;
              color: #9ca3af;
              font-size: 13px;
              margin-top: 0;
              padding: 30px 40px;
              border-top: 1px solid #f3f4f6;
              background-color: #f9fafb;
            }
            .footer p {
              margin: 5px 0;
            }

            @media screen and (max-width: 600px) {
              body {
                margin: 0 !important;
                border-radius: 0 !important;
                width: 100% !important;
              }
              .content {
                padding: 30px 20px !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🔐 Password Reset Request</h1>
          </div>
          
          <div class="content">
            <p>Hello <strong>${userFullName}</strong>,</p>
            
            <p>We received a request to reset your password for your Tuition Center account.</p>
            
            <p>Click the button below to reset your password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset My Password</a>
            </div>
            
            <div class="info-box">
              <strong>⏰ This link will expire in 1 hour</strong>
              <p style="margin: 5px 0 0 0; font-size: 14px;">For security reasons, this password reset link is only valid for 1 hour.</p>
            </div>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: white; padding: 10px; border-radius: 4px; font-size: 12px;">
              ${resetLink}
            </p>
            
            <div class="warning-box">
              <strong>⚠️ Didn't request this?</strong>
              <p style="margin: 5px 0 0 0; font-size: 14px;">If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
            </div>
            
            <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
              Best regards,<br>
              <strong>Tuition Center Team</strong>
            </p>
          </div>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>© ${new Date().getFullYear()} Tuition Center. All rights reserved.</p>
          </div>
        </body>
        </html>
      `,
      text: `
Password Reset Request

Hello ${userFullName},

We received a request to reset your password for your Tuition Center account.

Click this link to reset your password:
${resetLink}

This link will expire in 1 hour.

If you didn't request this password reset, please ignore this email.

Best regards,
Tuition Center Team
      `
    };

    const info = await transporter.sendMail(mailOptions);
    return info;

  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
}

async function sendTemporaryPasswordEmail(to, userFullName, temporaryPassword) {
  try {
    const transporter = createTransporter();
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

    return await transporter.sendMail({
      from: `"Tuition Center" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Account Created - Temporary Password',
      html: `
        <p>Hello ${userFullName},</p>
        <p>Your account has been created or updated by an administrator.</p>
        <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
        <p>Please log in and change your password immediately:</p>
        <p><a href="${loginUrl}">${loginUrl}</a></p>
      `,
      text: `Hello ${userFullName},\n\nYour account has been created or updated.\nTemporary Password: ${temporaryPassword}\nLogin: ${loginUrl}\nPlease change your password immediately.`
    });
  } catch (error) {
    console.error('Error sending temporary password email:', error);
    throw error;
  }
}

async function sendRoleStatusChangedEmail(to, userFullName, details) {
  try {
    const transporter = createTransporter();
    return await transporter.sendMail({
      from: `"Tuition Center" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Account Role/Status Updated',
      html: `
        <p>Hello ${userFullName},</p>
        <p>Your account access has been updated by an administrator.</p>
        <ul>
          <li>Role: ${details.oldRole || '-'} → ${details.newRole || '-'}</li>
          <li>Status: ${details.oldStatus || '-'} → ${details.newStatus || '-'}</li>
        </ul>
      `,
      text: `Hello ${userFullName}, your account has been updated. Role: ${details.oldRole || '-'} -> ${details.newRole || '-'}, Status: ${details.oldStatus || '-'} -> ${details.newStatus || '-'}.`
    });
  } catch (error) {
    console.error('Error sending role/status email:', error);
    throw error;
  }
}

async function sendEnrollmentConfirmationEmail(to, userFullName, enrollment) {
  try {
    const transporter = createTransporter();
    return await transporter.sendMail({
      from: `"Tuition Center" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Enrollment Confirmation',
      html: `
        <p>Hello ${userFullName},</p>
        <p>You have been enrolled successfully.</p>
        <ul>
          <li>Type: ${enrollment.targetType}</li>
          <li>ID: ${enrollment.targetId}</li>
          <li>Date: ${enrollment.enrolledAt}</li>
        </ul>
      `,
      text: `Hello ${userFullName}, you were enrolled in ${enrollment.targetType} #${enrollment.targetId} on ${enrollment.enrolledAt}.`
    });
  } catch (error) {
    console.error('Error sending enrollment confirmation email:', error);
    throw error;
  }
}

async function sendWelcomeEmail(to, userFullName, temporaryPassword) {
  try {
    return await sendTemporaryPasswordEmail(to, userFullName, temporaryPassword);
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}

async function sendPasswordChangedConfirmationEmail(to, userFullName) {
  try {
    const transporter = createTransporter();
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

    return await transporter.sendMail({
      from: `"Tuition Center" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Password Changed Successfully',
      html: `
        <p>Hello ${userFullName || 'User'},</p>
        <p>Your password was changed successfully.</p>
        <p>If you made this change, no further action is needed.</p>
        <p>If you did <strong>not</strong> change your password, please contact support immediately and secure your account.</p>
        <p><a href="${loginUrl}">${loginUrl}</a></p>
      `,
      text: `Hello ${userFullName || 'User'}, your password was changed successfully. If this was not you, contact support immediately. Login: ${loginUrl}`
    });
  } catch (error) {
    console.error('Error sending password changed confirmation email:', error);
    throw error;
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendTemporaryPasswordEmail,
  sendRoleStatusChangedEmail,
  sendEnrollmentConfirmationEmail,
  sendWelcomeEmail,
  sendPasswordChangedConfirmationEmail
};
