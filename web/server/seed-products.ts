import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  // Check if Brandon product already exists
  const existingProducts = await stripe.products.search({ query: "name:'Brandon AI Coach'" });
  if (existingProducts.data.length > 0) {
    console.log('Brandon AI Coach product already exists');
    console.log('Product ID:', existingProducts.data[0].id);
    
    // List existing prices
    const prices = await stripe.prices.list({ product: existingProducts.data[0].id, active: true });
    console.log('Existing prices:');
    prices.data.forEach(p => {
      console.log(`  - ${p.id}: $${(p.unit_amount || 0) / 100}/${p.recurring?.interval || 'one-time'}`);
    });
    return;
  }

  // Create the Brandon AI Coach product
  const product = await stripe.products.create({
    name: 'Brandon AI Coach',
    description: 'Your personal AI fitness coach. Get custom workout plans, daily check-ins, and ongoing support.',
    metadata: {
      app: 'brandon',
      type: 'subscription',
    }
  });

  console.log('Created product:', product.id);

  // Create monthly price - $15/month
  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 1500, // $15.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      plan: 'monthly',
    }
  });

  console.log('Created monthly price:', monthlyPrice.id, '- $15/month');

  // Create yearly price - $80/year
  const yearlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 8000, // $80.00
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: {
      plan: 'yearly',
    }
  });

  console.log('Created yearly price:', yearlyPrice.id, '- $80/year');
  
  console.log('\nDone! Products and prices created successfully.');
}

createProducts().catch(console.error);
