export function stripeCheckoutConfig(){
 const secretKey=process.env.STRIPE_SECRET_KEY, priceId=process.env.STRIPE_PRO_PRICE_ID;
 return secretKey && priceId ? {secretKey,priceId} : null;
}
