import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';

export default function extension() {
  render(<Extension />, document.body);
}

const Extension = () => {
  // Check if we have any actual discount allocations right at the start
  const hasActualDiscounts = shopify.discountAllocations.value && shopify.discountAllocations.value.length > 0;
  const [isInitialized, setIsInitialized] = useState(false);
  const [discounts, setDiscounts] = useState({
    shippingDiscounts: [],
    orderDiscounts: [],
    productDiscounts: []
  });

  // Access APIs from global shopify object (Preact Signals)
  const cost = shopify.cost.value;
  const currency = cost?.amount?.currency || 'EUR';
  const cartLines = shopify.lines.value || [];
  const cartDiscountAllocations = shopify.discountAllocations.value || [];
  const settings = shopify.extension.settings || {};
  const totalAmount = cost?.amount;
  const shippingAddress = shopify.shippingAddress?.value;
  const deliveryGroups = shopify.deliveryGroups?.value || [];

  console.log("[Extension] Hooks state", {
    currency, 
    cartLines: cartLines.length, 
    cartDiscountAllocations: cartDiscountAllocations.length, 
    settings, 
    totalAmount, 
    deliveryGroups: deliveryGroups.length
  });

  const safeTranslate = (key, options = {}) => {
    try {
      const result = shopify.i18n.translate(key, options);
      console.log(`[safeTranslate] key: ${key}, result:`, result);
      return result;
    } catch (e) {
      const fallbacks = {
        'discountActivated': 'Discount successfully activated! 🎉',
        'youSave': `You save ${options?.amount || '0'} on your order 🤩`,
        'freeShipping': 'FREE',
        'automaticFreeShipping': 'Automatic Free Shipping'
      };
      console.log(`[safeTranslate] FALLBACK for key: ${key}`);
      return fallbacks[key] || key;
    }
  };

  const detectAutomaticFreeShipping = () => {
    console.log("[detectAutomaticFreeShipping] called with deliveryGroups:", deliveryGroups.length);
    if (!deliveryGroups || deliveryGroups.length === 0) return null;

    let detectedFreeShipping = [];

    for (const group of deliveryGroups) {
      if (group.selectedDeliveryOption) {
        const selectedOption = group.selectedDeliveryOption;
        const shippingCost = parseFloat(selectedOption.cost?.amount || "0");
        const shippingTitle = selectedOption.title || '';
        const shippingHandle = selectedOption.handle || '';
        const isCurrentlyFree = shippingCost === 0;

        console.log("[detectAutomaticFreeShipping] selectedOption:", {
          shippingCost, shippingTitle, isCurrentlyFree
        });

        if (isCurrentlyFree) {
          let originalShippingCost = 0;

          if (group.deliveryOptions && Array.isArray(group.deliveryOptions)) {
            for (const option of group.deliveryOptions) {
              const optionCost = parseFloat(option.cost?.amount || "0");
              const optionTitle = option.title || '';
              if (optionCost > 0 && (
                optionTitle.toLowerCase().includes('standard') ||
                optionTitle.toLowerCase().includes('shipping') ||
                optionTitle.toLowerCase().includes('versand')
              )) {
                originalShippingCost = Math.max(originalShippingCost, optionCost);
              }
            }
          }

          if (originalShippingCost === 0) {
            originalShippingCost = parseFloat(settings.default_shipping_value) || 3.49;
          }

          const freeShippingTitle = shippingTitle || safeTranslate('automaticFreeShipping');

          const detected = {
            id: `automatic-free-shipping-${group.id || Math.random()}`,
            type: 'automatic',
            title: freeShippingTitle,
            totalAmount: 0,
            actualValue: originalShippingCost,
            level: 'cart',
            category: 'shipping',
            isAutomaticFreeShipping: true
          };
          console.log("[detectAutomaticFreeShipping] detected:", detected);
          detectedFreeShipping.push(detected);
        }
      }
    }

    return detectedFreeShipping.length > 0 ? detectedFreeShipping : null;
  };

  useEffect(() => {
    console.log("[useEffect] triggered");
    if (!isInitialized) {
      setIsInitialized(true);
    }

    const processedDiscounts = new Map();
    const shippingDiscounts = [];
    const orderDiscounts = [];

    // Process cart-level discount allocations
    if (cartDiscountAllocations && Array.isArray(cartDiscountAllocations)) {
      console.log("[useEffect] processing cart allocations:", cartDiscountAllocations.length);
      
      cartDiscountAllocations.forEach((alloc) => {
        const code = alloc.code?.trim();
        const title = alloc.title?.trim();
        const discountId = code ? `code:${code.toLowerCase()}` : `auto:${title?.toLowerCase() || 'unnamed'}`;
        
        const isShippingDiscount = 
          alloc.targetType === "shipping_line" || 
          alloc.targetSelection === "shipping" ||
          (title && (
            title.toLowerCase().includes('ship') ||
            title.toLowerCase().includes('versand') ||
            title.toLowerCase().includes('kostenlos')
          ));

        const isOrderDiscount = !isShippingDiscount && alloc.targetType !== "line_item";
        const discountAmount = parseFloat(alloc.discountedAmount?.amount || 0);

        console.log("[useEffect] allocation:", { 
          code, 
          title, 
          isShippingDiscount, 
          isOrderDiscount, 
          discountAmount,
          targetType: alloc.targetType
        });

        if (isShippingDiscount) {
          const shippingKey = `shipping:${discountId}`;
          if (!processedDiscounts.has(shippingKey)) {
            const displayTitle = code ? code.toUpperCase() : (title || safeTranslate('automaticFreeShipping'));
            const actualValue = discountAmount || parseFloat(settings.default_shipping_value) || 3.49;
            
            shippingDiscounts.push({
              id: shippingKey,
              type: code ? 'code' : 'automatic',
              title: displayTitle,
              totalAmount: discountAmount,
              actualValue: actualValue,
              level: 'cart',
              category: 'shipping'
            });
            processedDiscounts.set(shippingKey, true);
          }
        } else if (isOrderDiscount) {
          const orderKey = `order:${discountId}`;
          if (!processedDiscounts.has(orderKey)) {
            const displayTitle = code ? code.toUpperCase() : (title || 'Automatic Discount');
            
            orderDiscounts.push({
              id: orderKey,
              type: code ? 'code' : 'automatic',
              title: displayTitle,
              totalAmount: discountAmount,
              level: 'cart',
              category: 'order'
            });
            processedDiscounts.set(orderKey, true);
          }
        }
      });
    }

      // We're no longer auto-detecting free shipping as a discount
    console.log("[useEffect] final discounts:", { 
      shippingDiscounts: shippingDiscounts.length, 
      orderDiscounts: orderDiscounts.length 
    });
    
    setDiscounts({ shippingDiscounts, orderDiscounts, productDiscounts: [] });
  }, [cartDiscountAllocations, deliveryGroups, settings.default_shipping_value, isInitialized]);

  const calculatedData = useMemo(() => {
    console.log("[useMemo] calculating...");
    if (!isInitialized) {
      console.log("[useMemo] not initialized yet");
      return null;
    }

    // Only consider actual discounts from cart discount allocations
    const hasActualDiscounts = cartDiscountAllocations && cartDiscountAllocations.length > 0;
    
    const discountMap = new Map();
    let totalDiscount = 0;
    let totalCartDiscount = 0;
    let hasShippingDiscount = false;
    let shippingDiscountValue = 0;

    let currentSubtotal = 0;
    let totalLineItemDiscounts = 0;

    const lineDiscountsByCode = new Map();
    
    // Process line item discounts
    cartLines.forEach((line, idx) => {
      const currentLineTotal = parseFloat(line.cost?.totalAmount?.amount || 0);
      currentSubtotal += currentLineTotal;

      if (line.discountAllocations && Array.isArray(line.discountAllocations)) {
        line.discountAllocations.forEach((alloc) => {
          const discountAmount = parseFloat(alloc.discountedAmount?.amount || 0);
          const code = alloc.code?.trim();
          const title = alloc.title?.trim();
          const type = code ? "code" : "automatic";
          const discountId = code ? code.toLowerCase() : title?.toLowerCase() || 'unnamed';
          const key = `line-${type}:${discountId}`;
          
          totalLineItemDiscounts += discountAmount;

          if (lineDiscountsByCode.has(key)) {
            const existing = lineDiscountsByCode.get(key);
            existing.totalAmount += discountAmount;
          } else {
            const displayTitle = code ? code.toUpperCase() : (title || 'Product Discount');
            lineDiscountsByCode.set(key, {
              type,
              title: displayTitle,
              totalAmount: discountAmount,
              level: "line-item",
              category: "product"
            });
          }
          
          console.log(`[useMemo] line ${idx} discount:`, { discountAmount, code, title });
        });
      }
    });

    lineDiscountsByCode.forEach((discount, key) => {
      discountMap.set(key, discount);
    });

    // Process shipping discounts
    discounts.shippingDiscounts.forEach(discount => {
      const key = discount.id;
      if (!discountMap.has(key)) {
        discountMap.set(key, discount);
        hasShippingDiscount = true;
        shippingDiscountValue += discount.actualValue || 0;
        if (discount.totalAmount > 0) {
          totalCartDiscount += discount.totalAmount;
        }
      }
    });

    // Process order discounts
    discounts.orderDiscounts.forEach(discount => {
      const key = discount.id;
      if (!discountMap.has(key)) {
        discountMap.set(key, discount);
        if (discount.totalAmount > 0) {
          totalCartDiscount += discount.totalAmount;
        }
      }
    });

    totalDiscount = totalLineItemDiscounts + totalCartDiscount;

    const result = { 
      uniqueDiscounts: Array.from(discountMap.values()), 
      totalDiscount, 
      totalCartDiscount,
      hasShippingDiscount,
      shippingDiscountValue,
      totalLineItemDiscounts,
      currentSubtotal
    };
    
    console.log("[useMemo] calculated result:", result);
    return result;
  }, [cartLines, discounts, isInitialized]);

  const formatCurrency = (amount) => {
    try {
      return shopify.i18n.formatCurrency(amount);
    } catch (e) {
      return `€${parseFloat(amount).toFixed(2)}`;
    }
  };

  // Always render something for testing
  if (!calculatedData) {
    console.log("[render] calculatedData is null, showing loading...");
    return (
      <s-banner tone="info">
        <s-text>Loading discount information...</s-text>
      </s-banner>
    );
  }

  const {
    totalDiscount,
    hasShippingDiscount,
    shippingDiscountValue,
  } = calculatedData;

  // Only count actual discounts, not potential shipping costs
  const totalSavings = hasActualDiscounts ? (totalDiscount + (hasShippingDiscount ? shippingDiscountValue : 0)) : 0;

  console.log("[render] Final values:", {
    totalDiscount,
    shippingDiscountValue,
    totalSavings,
    hasShippingDiscount,
    hasActualDiscounts,
    discountAllocations: cartDiscountAllocations?.length || 0
  });

  // When no discounts, don't show any banner
  if (totalSavings === 0 && !hasShippingDiscount) {
    console.log("[render] No discounts found");
    return null;
  }

  // Only show banner if we have actual discount allocations AND positive savings
  if (cartDiscountAllocations && cartDiscountAllocations.length > 0 && totalDiscount > 0) {
    console.log("[render] Showing discount banner with actual discount:", totalDiscount);
    return (
      <s-banner tone="success">
        <s-stack direction="block" gap="none">
          <s-text emphasis="bold">
            {safeTranslate('discountActivated')}
          </s-text>
          <s-text>
            {safeTranslate('youSave', { amount: formatCurrency(totalDiscount) })}
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  // No real discounts to show
  console.log("[render] No actual discounts found");
  return null;
};
