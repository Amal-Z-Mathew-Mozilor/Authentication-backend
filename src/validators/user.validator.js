import {body} from "express-validator"
export const registerValidator = () => {
    return [
        body("email")
            .trim()
            .notEmpty()
            .withMessage("Email is required")
            .bail()
            .isEmail()
            .withMessage("Invalid email address")
            .normalizeEmail(),

        body("password")
            .notEmpty()
            .withMessage("Password is required")
            .bail()
            .isLength({ min: 12 })
            .withMessage("Password must be at least 12 characters long")
            .matches(/[A-Z]/)
            .withMessage("Password must contain at least one uppercase letter")
            .matches(/[a-z]/)
            .withMessage("Password must contain at least one lowercase letter")
            .matches(/[0-9]/)
            .withMessage("Password must contain at least one number")
            .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
            .withMessage("Password must contain at least one special character")
            .matches(/^\S+$/)
            .withMessage("Password cannot contain spaces"),
    ];
};
export const forgotPasswordEmail=()=>{
return[
    body("email")
            .trim()
            .notEmpty()
            .withMessage("Email is required")
            .bail()
            .isEmail()
            .withMessage("Invalid email address")
            .normalizeEmail(),
    ];

}
export const resetPasswordValidator=()=>{
  return[
          body("email")
            .trim()
            .notEmpty()
            .withMessage("Email is required")
            .bail()
            .isEmail()
            .withMessage("Invalid email address")
            .normalizeEmail(),
        

        body("newPassword")
        .notEmpty()
        .withMessage("Password is required")
        .bail()
        .isLength({ min: 12 })
        .withMessage("Password must be at least 12 characters long")
        .matches(/[A-Z]/)
        .withMessage("Password must contain at least one uppercase letter")
        .matches(/[a-z]/)
        .withMessage("Password must contain at least one lowercase letter")
        .matches(/[0-9]/)
        .withMessage("Password must contain at least one number")
        .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
        .withMessage("Password must contain at least one special character")
        .matches(/^\S+$/)
        .withMessage("Password cannot contain spaces"),

            body("confirmPassword")
            .notEmpty()
            .withMessage("Password is required")
            .bail()
            .isLength({ min: 12 })
            .withMessage("Password must be at least 12 characters long")
            .matches(/[A-Z]/)
            .withMessage("Password must contain at least one uppercase letter")
            .matches(/[a-z]/)
            .withMessage("Password must contain at least one lowercase letter")
            .matches(/[0-9]/)
            .withMessage("Password must contain at least one number")
            .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
            .withMessage("Password must contain at least one special character")
            .matches(/^\S+$/)
            .withMessage("Password cannot contain spaces"),
 ];
}
export const loginEmailValidator=()=>{
   return[
    body("email")
            .trim()
            .notEmpty()
            .withMessage("Email is required")
            .bail()
            .isEmail()
            .withMessage("Invalid email address")
            .normalizeEmail(),
    ];
} 
export const changePasswordValidator=()=>{
   return[
              body("oldPassword")
             .notEmpty()
             .withMessage("Password is required")
             .bail()
             .isLength({ min: 12 })
             .withMessage("Password must be at least 12 characters long")
             .matches(/[A-Z]/)
             .withMessage("Password must contain at least one uppercase letter")
             .matches(/[a-z]/)
             .withMessage("Password must contain at least one lowercase letter")
             .matches(/[0-9]/)
             .withMessage("Password must contain at least one number")
             .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
             .withMessage("Password must contain at least one special character")
             .matches(/^\S+$/)
             .withMessage("Password cannot contain spaces"),

             body("newPassword")
             .notEmpty()
             .withMessage("Password is required")
             .bail()
             .isLength({ min: 12 })
             .withMessage("Password must be at least 12 characters long")
             .matches(/[A-Z]/)
             .withMessage("Password must contain at least one uppercase letter")
             .matches(/[a-z]/)
             .withMessage("Password must contain at least one lowercase letter")
             .matches(/[0-9]/)
             .withMessage("Password must contain at least one number")
             .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
             .withMessage("Password must contain at least one special character")
             .matches(/^\S+$/)
             .withMessage("Password cannot contain spaces"),
            
             body("confirmPassword")
             .notEmpty()
             .withMessage("Password is required")
             .bail()
             .isLength({ min: 12 })
             .withMessage("Password must be at least 12 characters long")
             .matches(/[A-Z]/)
             .withMessage("Password must contain at least one uppercase letter")
             .matches(/[a-z]/)
             .withMessage("Password must contain at least one lowercase letter")
             .matches(/[0-9]/)
             .withMessage("Password must contain at least one number")
             .matches(/[!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/~`]/)
             .withMessage("Password must contain at least one special character")
             .matches(/^\S+$/)
             .withMessage("Password cannot contain spaces"),
            ];
}

