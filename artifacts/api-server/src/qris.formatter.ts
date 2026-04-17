// QRIS Formatter

// Define the unified QRIS invoice format
const generateQrisInvoice = (invoiceDetails, totalAmount, uniqueCode, qrCodeReference, paymentStatus, expirationTime) => {
    // Create the invoice string
    let invoice = `Invoice Details:\n` +
        `- Invoice Number: ${invoiceDetails.invoiceNumber}\n` +
        `- Date: ${invoiceDetails.date}\n` +
        `- Customer Name: ${invoiceDetails.customerName}\n` +
        `- Description: ${invoiceDetails.description}\n` +
        `Total Amount: ${totalAmount} (Code: ${uniqueCode})\n` +
        `QR Code Reference: ${qrCodeReference}\n` +
        `Payment Status: ${paymentStatus}\n` +
        `Expires in: ${expirationTime} seconds\n`;

    // Define inline keyboard buttons
    const inlineKeyboard = [
        [{ text: 'Check Status', callback_data: 'check_status' }],
        [{ text: 'Cancel Payment', callback_data: 'cancel_payment' }]
    ];

    // Return the formatted message and inline keyboard
    return {
        text: invoice,
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };
};

// Example usage
const invoiceDetails = {
    invoiceNumber: 'INV-12345',
    date: '2026-04-17',
    customerName: 'John Doe',
    description: 'Payment for services'
};
const totalAmount = '100.00';
const uniqueCode = 'QR12345';
const qrCodeReference = 'QR123456789';
const paymentStatus = 'Pending';
const expirationTime = '3600'; // 1 hour in seconds

const qrisInvoice = generateQrisInvoice(invoiceDetails, totalAmount, uniqueCode, qrCodeReference, paymentStatus, expirationTime);
console.log(qrisInvoice);