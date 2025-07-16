const db = require('../db'); // Adjust if your DB config file is elsewhere

// ADMIN: Create a new product
exports.createProduct = async (req, res) => {
  let {
    product_name,
    product_type,
    description,
    interest_rate,
    annual_fee,
    min_balance,
    tenure_months
  } = req.body;

  // Convert empty strings to null for numeric fields
  interest_rate = interest_rate === '' ? null : parseFloat(interest_rate);
  annual_fee = annual_fee === '' ? null : parseFloat(annual_fee);
  min_balance = min_balance === '' ? null : parseFloat(min_balance);
  tenure_months = tenure_months === '' ? null : parseInt(tenure_months);

  // ✅ Base validation (common for all)
  if (!product_name || !product_type || !description || interest_rate === null || isNaN(interest_rate)) {
    return res.redirect('/admin/products?error=Product name, type, description, and interest rate are required.');
  }

  // ✅ Type-specific validation and cleanup
  switch (product_type) {
    case 'savings':
      if (min_balance === null || isNaN(min_balance)) {
        return res.redirect('/admin/products?error=Minimum balance is required for savings.');
      }
      annual_fee = null;
      tenure_months = null;
      break;

    case 'fixed_deposit':
      if (min_balance === null || isNaN(min_balance)) {
        return res.redirect('/admin/products?error=Minimum balance is required for fixed deposits.');
      }
      if (!tenure_months || isNaN(tenure_months)) {
        return res.redirect('/admin/products?error=Tenure is required for fixed deposits.');
      }
      annual_fee = null;
      break;

    case 'credit_card':
      if (annual_fee === null || isNaN(annual_fee)) {
        return res.redirect('/admin/products?error=Annual fee is required for credit cards.');
      }
      min_balance = null;
      tenure_months = null;
      break;

    default:
      return res.redirect('/admin/products?error=Invalid product type.');
  }

  try {
    await db.query(
      `INSERT INTO products 
      (product_name, product_type, description, interest_rate, annual_fee, min_balance, tenure_months)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [product_name, product_type, description, interest_rate, annual_fee, min_balance, tenure_months]
    );
    res.redirect('/admin/products?success=Product created successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Failed to create product');
  }
};

// ADMIN: View all products
exports.getAllProducts = async (req, res) => {
  try {
    const [products] = await db.query(`SELECT * FROM products`);
    const { success, error } = req.query;
    res.render('adminProducts', {
      products,
      success,
      error,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading products.');
  }
};

// ADMIN: Edit product form
exports.editProductForm = async (req, res) => {
  const { id } = req.params;
  try {
    const [[product]] = await db.query(`SELECT * FROM products WHERE product_id = ?`, [id]);
    res.render('editProduct', { product });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading product.');
  }
};

// ADMIN: Update product
exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  let {
    product_name,
    product_type,
    description,
    interest_rate,
    annual_fee,
    min_balance,
    tenure_months
  } = req.body;

  // Convert empty strings to null for numeric fields
  interest_rate = interest_rate === '' ? null : parseFloat(interest_rate);
  annual_fee = annual_fee === '' ? null : parseFloat(annual_fee);
  min_balance = min_balance === '' ? null : parseFloat(min_balance);
  tenure_months = tenure_months === '' ? null : parseInt(tenure_months);

  // Load product for re-rendering in case of validation errors
  const [[product]] = await db.query(`SELECT * FROM products WHERE product_id = ?`, [id]);

  // ✅ Base validation (common for all)
  if (!product_name || !product_type || !description || interest_rate === null || isNaN(interest_rate)) {
    return res.render('editProduct', {
      product,
      error: 'Product name, type, description, and interest rate are required.',
      success: null
    });
  }

  // ✅ Type-specific validation and cleanup
  switch (product_type) {
    case 'savings':
      if (min_balance === null || isNaN(min_balance)) {
        return res.render('editProduct', {
          product,
          error: 'Minimum balance is required for savings.',
          success: null
        });
      }
      annual_fee = null;
      tenure_months = null;
      break;

    case 'fixed_deposit':
      if (min_balance === null || isNaN(min_balance)) {
        return res.render('editProduct', {
          product,
          error: 'Minimum balance is required for fixed deposits.',
          success: null
        });
      }
      if (!tenure_months || isNaN(tenure_months)) {
        return res.render('editProduct', {
          product,
          error: 'Tenure is required for fixed deposits.',
          success: null
        });
      }
      annual_fee = null;
      break;

    case 'credit_card':
      if (annual_fee === null || isNaN(annual_fee)) {
        return res.render('editProduct', {
          product,
          error: 'Annual fee is required for credit cards.',
          success: null
        });
      }
      min_balance = null;
      tenure_months = null;
      break;

    default:
      return res.render('editProduct', {
        product,
        error: 'Invalid product type.',
        success: null
      });
  }

  try {
    await db.query(
      `UPDATE products SET product_name=?, product_type=?, description=?, interest_rate=?, annual_fee=?, min_balance=?, tenure_months=? WHERE product_id=?`,
      [product_name, product_type, description, interest_rate, annual_fee, min_balance, tenure_months, id]
    );
    res.redirect('/admin/products?success=Product updated successfully');
  } catch (err) {
    console.error(err);
    res.render('editProduct', {
      product,
      error: 'Failed to update product.',
      success: null
    });
  }
};

// ADMIN: Delete product
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`DELETE FROM products WHERE product_id = ?`, [id]);
    res.redirect('/admin/products?success=Product deleted successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/products?error=Failed to delete product');
  }
};

// USER: View available products
exports.viewAvailableProducts = async (req, res) => {
  try {
    const [products] = await db.query(`SELECT * FROM products`);
    res.render('product', {
      user: req.session.user,
      products,
      error: req.query.error || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading products');
  }
};